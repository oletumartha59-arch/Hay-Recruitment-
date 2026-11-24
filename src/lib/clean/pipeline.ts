import type {
  CleaningDecision,
  DataQualityReport,
  EmployeeRecord,
  WorkforceSettings,
} from '../../types/workforce';
import {
  parseExitTarget,
  standardiseAttentionStatus,
  standardiseDepartment,
  standardiseJobLevel,
  standardiseLocation,
  standardiseWorkArrangement,
  standardiseWorkStatus,
  standardiseWorkloadLevel,
} from './aliases';
import { diffDaysIso, diffMonthsIso, parseUkDate } from './dates';
import { cleanText, isMissingMarker } from './fuzzy';
import { enrichSignalsAndScores, median, quantile } from '../features/signals';

export interface CleanPipelineOptions {
  mapping: Record<string, string>;
  settings: WorkforceSettings;
  disabledRuleIds?: Set<string>;
  previousSnapshotEmployees?: EmployeeRecord[];
  referenceTodayIso?: string;
}

export interface CleanPipelineResult {
  employees: EmployeeRecord[];
  engagementScaleMax: number;
  latestLastUpdated: string;
  report: DataQualityReport;
}

function parseWholeNumber(raw: unknown): { value: number | null; wasCoerced: boolean; note?: string } {
  if (isMissingMarker(raw)) return { value: null, wasCoerced: false };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { value: null, wasCoerced: false };
    const rounded = Math.round(raw);
    return { value: rounded, wasCoerced: rounded !== raw };
  }
  const s = cleanText(raw).replace(/,/g, '').replace(/%$/, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, wasCoerced: false };
  const rounded = Math.round(n);
  return { value: rounded, wasCoerced: String(raw).trim() !== String(rounded) };
}

export function detectEngagementScaleMax(scores: number[], override: number | null): number {
  if (override !== null && override > 0) return override;
  const maxVal = scores.length > 0 ? Math.max(...scores) : 10;
  if (maxVal <= 5) return 5;
  if (maxVal <= 10) return 10;
  if (maxVal <= 20) return 20;
  if (maxVal <= 100) return 100;
  return Math.ceil(maxVal / 10) * 10;
}

export function runCleaningPipeline(
  rawRows: Array<Record<string, unknown>>,
  options: CleanPipelineOptions
): CleanPipelineResult {
  const {
    mapping,
    settings,
    disabledRuleIds = new Set<string>(),
    previousSnapshotEmployees,
    referenceTodayIso,
  } = options;

  const todayIso = referenceTodayIso ?? new Date().toISOString().slice(0, 10);

  const getCell = (row: Record<string, unknown>, fieldKey: string): unknown => {
    const sourceCol = mapping[fieldKey];
    if (!sourceCol) return undefined;
    return row[sourceCol];
  };

  const decisionsMap = new Map<string, CleaningDecision>();
  const recordDecision = (
    ruleId: string,
    ruleName: string,
    description: string,
    sample: { employeeId: string; field: string; from: string; to: string }
  ) => {
    const existing = decisionsMap.get(ruleId);
    if (existing) {
      existing.affectedCount += 1;
      if (existing.samples.length < 10) existing.samples.push(sample);
    } else {
      decisionsMap.set(ruleId, {
        id: ruleId,
        ruleId,
        ruleName,
        description,
        affectedCount: 1,
        enabled: !disabledRuleIds.has(ruleId),
        samples: [sample],
      });
    }
  };

  const rejectedRows: Array<{ rowIndex: number; employeeId: string; reason: string }> = [];
  let exactDuplicatesRemoved = 0;
  const conflictsResolved: Array<{
    employeeId: string;
    keptLastUpdated: string;
    discardedLastUpdated: string;
  }> = [];

  interface IntermediateRow {
    rowIndex: number;
    employeeId: string;
    employeeName: string;
    department: string;
    jobLevel: string;
    location: string;
    workArrangement: ReturnType<typeof standardiseWorkArrangement>['value'];
    workStatus: ReturnType<typeof standardiseWorkStatus>['value'];
    rawWorkStatus: string;
    hireDate: string;
    lastUpdated: string;
    totalTasks: number | null;
    completedTasks: number | null;
    pendingTasks: number | null;
    overdueTasks: number | null;
    engagementScore: number | null;
    workloadLevel: ReturnType<typeof standardiseWorkloadLevel>['value'];
    leaveDaysRemaining: number | null;
    attentionStatus: ReturnType<typeof standardiseAttentionStatus>['value'];
    attentionReason: string;
    exitTarget?: boolean;
    issues: string[];
    imputedFields: string[];
    outlierFields: string[];
    fixesApplied: Array<{ field: string; rule: string; from: string; to: string }>;
    rawFingerprint: string;
  }

  const parsedRows: IntermediateRow[] = [];
  let ambiguousDateCount = 0;
  const unmappedStatusCounts = new Map<string, number>();

  // Missingness tracking across columns
  const numericCols = [
    'totalTasks',
    'completedTasks',
    'pendingTasks',
    'overdueTasks',
    'engagementScore',
    'leaveDaysRemaining',
  ] as const;
  const missingCounts: Record<string, number> = {};
  for (const col of numericCols) missingCounts[col] = 0;

  rawRows.forEach((rawRow, idx) => {
    const rawId = cleanText(getCell(rawRow, 'employeeId')).toUpperCase();
    const rawName = cleanText(getCell(rawRow, 'employeeName'));
    const rawDept = cleanText(getCell(rawRow, 'department'));

    if (!rawId || !rawName || !rawDept) {
      rejectedRows.push({
        rowIndex: idx + 1,
        employeeId: rawId || '(missing)',
        reason: 'Missing required identity field (Employee ID, Employee Name, or Department).',
      });
      return;
    }

    const fixesApplied: IntermediateRow['fixesApplied'] = [];
    const issues: string[] = [];

    const deptStd = !disabledRuleIds.has('standardise_categories')
      ? standardiseDepartment(rawDept)
      : { value: rawDept, changed: false };
    if (deptStd.changed) {
      recordDecision(
        'standardise_categories',
        'Standardise text categories',
        'Normalise Department, Location, Job Level, Work Status, and Workload aliases and casing.',
        { employeeId: rawId, field: 'Department', from: rawDept, to: deptStd.value }
      );
      fixesApplied.push({ field: 'Department', rule: 'Alias & case normalisation', from: rawDept, to: deptStd.value });
    }

    const rawLevel = cleanText(getCell(rawRow, 'jobLevel'));
    const levelStd = !disabledRuleIds.has('standardise_categories')
      ? standardiseJobLevel(rawLevel)
      : { value: rawLevel || 'Consultant', changed: false };
    if (levelStd.changed) {
      recordDecision(
        'standardise_categories',
        'Standardise text categories',
        'Normalise Department, Location, Job Level, Work Status, and Workload aliases and casing.',
        { employeeId: rawId, field: 'Job Level', from: rawLevel, to: levelStd.value }
      );
      fixesApplied.push({ field: 'Job Level', rule: 'Level normalisation', from: rawLevel, to: levelStd.value });
    }

    const rawLoc = cleanText(getCell(rawRow, 'location'));
    const locStd = !disabledRuleIds.has('standardise_categories')
      ? standardiseLocation(rawLoc)
      : { value: rawLoc || 'London', changed: false };
    if (locStd.changed) {
      recordDecision(
        'standardise_categories',
        'Standardise text categories',
        'Normalise Department, Location, Job Level, Work Status, and Workload aliases and casing.',
        { employeeId: rawId, field: 'Location', from: rawLoc, to: locStd.value }
      );
      fixesApplied.push({ field: 'Location', rule: 'Title-case & UK city normalisation', from: rawLoc, to: locStd.value });
    }

    const rawArr = cleanText(getCell(rawRow, 'workArrangement'));
    const arrStd = standardiseWorkArrangement(rawArr);

    const rawStatus = cleanText(getCell(rawRow, 'workStatus'));
    const statusStd = standardiseWorkStatus(rawStatus, settings.statusAliases);
    if (statusStd.unmapped) {
      unmappedStatusCounts.set(rawStatus || '(blank)', (unmappedStatusCounts.get(rawStatus || '(blank)') ?? 0) + 1);
      issues.push(`Unrecognised Work Status "${rawStatus || '(blank)'}"`);
    } else if (statusStd.changed) {
      recordDecision(
        'standardise_categories',
        'Standardise text categories',
        'Normalise Department, Location, Job Level, Work Status, and Workload aliases and casing.',
        { employeeId: rawId, field: 'Work Status', from: rawStatus, to: statusStd.value }
      );
      fixesApplied.push({ field: 'Work Status', rule: 'Status alias map', from: rawStatus, to: statusStd.value });
    }

    const rawHire = getCell(rawRow, 'hireDate');
    const hireParsed = parseUkDate(rawHire, todayIso);
    if (!hireParsed.iso) {
      rejectedRows.push({
        rowIndex: idx + 1,
        employeeId: rawId,
        reason: `Unparseable Hire Date "${cleanText(rawHire)}".`,
      });
      return;
    }
    if (hireParsed.isFuture) {
      issues.push(`Hire Date (${hireParsed.iso}) is in the future`);
    }
    if (hireParsed.wasAmbiguous) ambiguousDateCount += 1;
    if (cleanText(rawHire) !== hireParsed.iso) {
      recordDecision(
        'parse_dates',
        'Parse UK & Excel dates',
        'Convert DD/MM/YYYY, text dates, and Excel serials into ISO YYYY-MM-DD.',
        { employeeId: rawId, field: 'Hire Date', from: cleanText(rawHire), to: hireParsed.iso }
      );
      fixesApplied.push({ field: 'Hire Date', rule: 'Date normalisation', from: cleanText(rawHire), to: hireParsed.iso });
    }

    const rawUpdated = getCell(rawRow, 'lastUpdated');
    const updatedParsed = parseUkDate(rawUpdated, todayIso);
    const effectiveLastUpdated = updatedParsed.iso ?? hireParsed.iso;
    if (!updatedParsed.iso) {
      issues.push(`Invalid Last Updated "${cleanText(rawUpdated)}"; defaulted to Hire Date`);
    }
    if (updatedParsed.isFuture) {
      issues.push(`Last Updated (${effectiveLastUpdated}) is in the future`);
    }
    if (updatedParsed.wasAmbiguous) ambiguousDateCount += 1;
    if (effectiveLastUpdated < hireParsed.iso) {
      issues.push(`Hire Date (${hireParsed.iso}) is after Last Updated (${effectiveLastUpdated})`);
    }

    const totalNum = parseWholeNumber(getCell(rawRow, 'totalTasks'));
    const compNum = parseWholeNumber(getCell(rawRow, 'completedTasks'));
    const pendNum = parseWholeNumber(getCell(rawRow, 'pendingTasks'));
    const overNum = parseWholeNumber(getCell(rawRow, 'overdueTasks'));
    const engNum = parseWholeNumber(getCell(rawRow, 'engagementScore'));
    const leaveNum = parseWholeNumber(getCell(rawRow, 'leaveDaysRemaining'));

    if (totalNum.value === null) missingCounts.totalTasks += 1;
    if (compNum.value === null) missingCounts.completedTasks += 1;
    if (pendNum.value === null) missingCounts.pendingTasks += 1;
    if (overNum.value === null) missingCounts.overdueTasks += 1;
    if (engNum.value === null) missingCounts.engagementScore += 1;
    if (leaveNum.value === null) missingCounts.leaveDaysRemaining += 1;

    if (totalNum.wasCoerced || compNum.wasCoerced || pendNum.wasCoerced || overNum.wasCoerced || engNum.wasCoerced || leaveNum.wasCoerced) {
      recordDecision(
        'coerce_numbers',
        'Coerce numeric values',
        'Strip commas/percent signs and round whole-number fields.',
        {
          employeeId: rawId,
          field: 'Numeric fields',
          from: String(getCell(rawRow, 'engagementScore') ?? ''),
          to: String(engNum.value ?? ''),
        }
      );
    }

    const rawWorkload = cleanText(getCell(rawRow, 'workloadLevel'));
    const workloadStd = standardiseWorkloadLevel(rawWorkload);
    if (workloadStd.changed) {
      recordDecision(
        'standardise_categories',
        'Standardise text categories',
        'Normalise Department, Location, Job Level, Work Status, and Workload aliases and casing.',
        { employeeId: rawId, field: 'Workload Level', from: rawWorkload, to: workloadStd.value }
      );
      fixesApplied.push({ field: 'Workload Level', rule: 'Workload alias map', from: rawWorkload, to: workloadStd.value });
    }

    const rawAtt = cleanText(getCell(rawRow, 'attentionStatus'));
    const attStd = standardiseAttentionStatus(rawAtt);
    if (attStd.changed) {
      fixesApplied.push({ field: 'Attention Status', rule: 'Attention status map', from: rawAtt, to: attStd.value });
    }

    const rawReason = cleanText(getCell(rawRow, 'attentionReason'));
    const exitTarget = parseExitTarget(getCell(rawRow, 'exitTarget'));

    const rawFingerprint = JSON.stringify([
      rawId,
      rawName,
      deptStd.value,
      levelStd.value,
      locStd.value,
      statusStd.value,
      hireParsed.iso,
      effectiveLastUpdated,
      totalNum.value,
      compNum.value,
      pendNum.value,
      overNum.value,
      engNum.value,
      workloadStd.value,
      leaveNum.value,
      attStd.value,
      rawReason,
    ]);

    parsedRows.push({
      rowIndex: idx + 1,
      employeeId: rawId,
      employeeName: rawName,
      department: deptStd.value,
      jobLevel: levelStd.value,
      location: locStd.value,
      workArrangement: arrStd.value,
      workStatus: statusStd.value,
      rawWorkStatus: rawStatus,
      hireDate: hireParsed.iso,
      lastUpdated: effectiveLastUpdated,
      totalTasks: totalNum.value !== null ? Math.max(0, totalNum.value) : null,
      completedTasks: compNum.value !== null ? Math.max(0, compNum.value) : null,
      pendingTasks: pendNum.value !== null ? Math.max(0, pendNum.value) : null,
      overdueTasks: overNum.value !== null ? Math.max(0, overNum.value) : null,
      engagementScore: engNum.value !== null ? Math.max(0, engNum.value) : null,
      workloadLevel: workloadStd.value,
      leaveDaysRemaining: leaveNum.value !== null ? leaveNum.value : null,
      attentionStatus: attStd.value,
      attentionReason: rawReason,
      exitTarget,
      issues,
      imputedFields: [],
      outlierFields: [],
      fixesApplied,
      rawFingerprint,
    });
  });

  // Step 7: Deduplicate
  const byId = new Map<string, IntermediateRow>();
  for (const row of parsedRows) {
    const existing = byId.get(row.employeeId);
    if (!existing) {
      byId.set(row.employeeId, row);
      continue;
    }
    if (existing.rawFingerprint === row.rawFingerprint) {
      exactDuplicatesRemoved += 1;
      recordDecision(
        'deduplicate_exact',
        'Remove exact duplicates',
        'Drop identical duplicate rows sharing the same Employee ID and values.',
        { employeeId: row.employeeId, field: 'Employee ID', from: 'Duplicate row', to: 'Removed' }
      );
    } else {
      // Conflict resolution: keep latest Last Updated
      const keepNew = row.lastUpdated >= existing.lastUpdated;
      const kept = keepNew ? row : existing;
      const discarded = keepNew ? existing : row;
      conflictsResolved.push({
        employeeId: row.employeeId,
        keptLastUpdated: kept.lastUpdated,
        discardedLastUpdated: discarded.lastUpdated,
      });
      recordDecision(
        'deduplicate_conflict',
        'Resolve conflicting Employee IDs',
        'Keep the record with the most recent Last Updated date when the same Employee ID has differing values.',
        {
          employeeId: row.employeeId,
          field: 'Last Updated',
          from: discarded.lastUpdated,
          to: kept.lastUpdated,
        }
      );
      byId.set(row.employeeId, kept);
    }
  }

  const dedupedRows = Array.from(byId.values());

  // Step 5: Group-median & overall-median numeric imputation
  const imputeAllowed = !disabledRuleIds.has('impute_missing');
  const peerMedians = new Map<string, Record<string, number>>();
  const overallMedians: Record<string, number> = {};

  for (const col of numericCols) {
    const vals = dedupedRows
      .map((r) => r[col])
      .filter((v): v is number => v !== null);
    overallMedians[col] = Math.round(median(vals));
  }

  const groupBuckets = new Map<string, IntermediateRow[]>();
  for (const r of dedupedRows) {
    const key = `${r.department}|||${r.jobLevel}`;
    const arr = groupBuckets.get(key) ?? [];
    arr.push(r);
    groupBuckets.set(key, arr);
  }
  for (const [key, list] of groupBuckets.entries()) {
    const rec: Record<string, number> = {};
    for (const col of numericCols) {
      const vals = list.map((r) => r[col]).filter((v): v is number => v !== null);
      rec[col] = vals.length >= 5 ? Math.round(median(vals)) : overallMedians[col];
    }
    peerMedians.set(key, rec);
  }

  let imputedCellsCount = 0;
  for (const r of dedupedRows) {
    const key = `${r.department}|||${r.jobLevel}`;
    const meds = peerMedians.get(key) ?? overallMedians;
    for (const col of numericCols) {
      if (r[col] === null) {
        if (imputeAllowed) {
          r[col] = Math.max(0, meds[col] ?? 0);
          r.imputedFields.push(col);
          imputedCellsCount += 1;
          recordDecision(
            'impute_missing',
            'Impute missing numeric cells',
            'Fill missing numeric values with the Department + Job Level peer median (when >= 5 peers exist) or overall median.',
            { employeeId: r.employeeId, field: col, from: 'Missing', to: String(r[col]) }
          );
        } else {
          r[col] = 0;
          r.issues.push(`Missing ${col}`);
        }
      }
    }
    if ((r.leaveDaysRemaining ?? 0) < 0) {
      r.issues.push(`Leave Days Remaining (${r.leaveDaysRemaining}) is negative`);
      r.leaveDaysRemaining = 0;
    }
  }

  // Engagement scale detection
  const engagementScaleMax = detectEngagementScaleMax(
    dedupedRows.map((r) => r.engagementScore ?? 0),
    settings.engagementScaleOverride
  );

  // Latest Last Updated for reproducible tenure & staleness
  const latestLastUpdated =
    dedupedRows.length > 0
      ? dedupedRows.reduce((max, r) => (r.lastUpdated > max ? r.lastUpdated : max), dedupedRows[0].lastUpdated)
      : todayIso;

  // Step 6: Outliers (3 * IQR flag, never delete)
  let outliersFlaggedCount = 0;
  for (const col of ['totalTasks', 'overdueTasks', 'leaveDaysRemaining'] as const) {
    const sorted = dedupedRows.map((r) => r[col] ?? 0).sort((a, b) => a - b);
    if (sorted.length >= 4) {
      const q1 = quantile(sorted, 25);
      const q3 = quantile(sorted, 75);
      const iqr = q3 - q1;
      const hi = q3 + 3 * iqr;
      const lo = q1 - 3 * iqr;
      if (iqr > 0) {
        for (const r of dedupedRows) {
          const v = r[col] ?? 0;
          if (v > hi || v < lo) {
            r.outlierFields.push(col);
            outliersFlaggedCount += 1;
          }
        }
      }
    }
  }

  // Step 8: Integrity rules & build EmployeeRecord
  const taskMismatchIds: string[] = [];
  const dateOrderIds: string[] = [];
  const engagementOutOfRangeIds: string[] = [];
  const negativeLeaveIds: string[] = [];

  const levelOrderMap = new Map<string, number>();
  settings.jobLevelOrder.forEach((lvl, idx) => levelOrderMap.set(lvl.toLowerCase(), idx + 1));

  const baseEmployees: EmployeeRecord[] = dedupedRows.map((r) => {
    const totalTasks = r.totalTasks ?? 0;
    const completedTasks = r.completedTasks ?? 0;
    const pendingTasks = r.pendingTasks ?? 0;
    const overdueTasks = r.overdueTasks ?? 0;
    const engagementScore = r.engagementScore ?? 0;
    const leaveDaysRemaining = r.leaveDaysRemaining ?? 0;

    let taskReconciled = true;
    if (completedTasks + pendingTasks + overdueTasks !== totalTasks) {
      taskReconciled = false;
      taskMismatchIds.push(r.employeeId);
      r.issues.push('Task counts do not reconcile');
    }

    if (r.hireDate > r.lastUpdated || r.hireDate > todayIso) {
      dateOrderIds.push(r.employeeId);
    }

    if (engagementScore < 0 || engagementScore > engagementScaleMax) {
      engagementOutOfRangeIds.push(r.employeeId);
      r.issues.push(`Engagement Score (${engagementScore}) outside detected scale 0–${engagementScaleMax}`);
    }

    if (leaveDaysRemaining < 0) {
      negativeLeaveIds.push(r.employeeId);
    }

    const openTasks = pendingTasks + overdueTasks;
    const completionRate = totalTasks > 0 ? completedTasks / totalTasks : null;
    const overdueShare = openTasks > 0 ? overdueTasks / openTasks : null;
    const engagementPct = Math.min(100, Math.max(0, (engagementScore / engagementScaleMax) * 100));
    const daysSinceUpdated = Math.max(0, diffDaysIso(latestLastUpdated, r.lastUpdated));
    const isStale = daysSinceUpdated > settings.staleDaysThreshold;
    const tenureMonths = diffMonthsIso(latestLastUpdated, r.hireDate);
    const jobLevelRank = levelOrderMap.get(r.jobLevel.toLowerCase()) ?? 99;
    const attentionReasonTags = r.attentionReason
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean);

    return {
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      department: r.department,
      jobLevel: r.jobLevel,
      location: r.location,
      workArrangement: r.workArrangement,
      workStatus: r.workStatus,
      rawWorkStatus: r.rawWorkStatus,
      hireDate: r.hireDate,
      lastUpdated: r.lastUpdated,
      totalTasks,
      completedTasks,
      pendingTasks,
      overdueTasks,
      engagementScore,
      workloadLevel: r.workloadLevel,
      leaveDaysRemaining,
      attentionStatus: r.attentionStatus,
      attentionReason: r.attentionReason,
      attentionReasonTags,
      exitTarget: r.exitTarget,
      tenureMonths,
      completionRate,
      openTasks,
      overdueShare,
      engagementPct,
      isStale,
      daysSinceUpdated,
      jobLevelRank,
      needsAttentionFlag: r.attentionStatus === 'Needs Attention',
      signals: [],
      hasWarningOrCriticalSignal: false,
      missedByCurrentProcess: false,
      flaggedWithoutSignal: false,
      engagementRisk: 0,
      workloadPressure: 0,
      deliveryRisk: 0,
      tenureRisk: 0,
      riskScore: 0,
      riskBand: 'Low',
      riskRankCompany: 0,
      riskRankDepartment: 0,
      riskDelta: null,
      drivers: [],
      dataQuality: {
        issues: r.issues,
        taskReconciled,
        imputedFields: r.imputedFields,
        outlierFields: r.outlierFields,
        fixesApplied: r.fixesApplied,
      },
    };
  });

  const enrichedEmployees = enrichSignalsAndScores(
    baseEmployees,
    settings,
    previousSnapshotEmployees
  );

  // 5-dimension Data Quality Score (0 to 100, equal 20% weights)
  const n = Math.max(1, dedupedRows.length);
  const totalCells = n * numericCols.length;
  const completeness = Math.round(Math.max(0, 100 - (imputedCellsCount / Math.max(1, totalCells)) * 100));
  const invalidCount =
    dateOrderIds.length + engagementOutOfRangeIds.length + negativeLeaveIds.length + unmappedStatusCounts.size;
  const validity = Math.round(Math.max(0, 100 - (invalidCount / n) * 100));
  const totalDuplicates = exactDuplicatesRemoved + conflictsResolved.length;
  const uniqueness = Math.round(Math.max(0, 100 - (totalDuplicates / Math.max(1, rawRows.length)) * 100));
  const consistency = Math.round(Math.max(0, 100 - (taskMismatchIds.length / n) * 100));
  const staleCount = enrichedEmployees.filter((e) => e.isStale).length;
  const freshness = Math.round(Math.max(0, 100 - (staleCount / n) * 100));

  const overallScore = Math.round((completeness + validity + uniqueness + consistency + freshness) / 5);

  const highMissingColumns = numericCols
    .map((col) => ({
      column: col,
      missingPct: Math.round((missingCounts[col] / Math.max(1, rawRows.length)) * 100),
    }))
    .filter((x) => x.missingPct > 40);

  const ruleFailures: DataQualityReport['ruleFailures'] = [];
  if (taskMismatchIds.length > 0) {
    ruleFailures.push({
      rule: 'Task count reconciliation',
      description: 'Completed + Pending + Overdue must equal Total Tasks.',
      count: taskMismatchIds.length,
      sampleIds: taskMismatchIds.slice(0, 10),
    });
  }
  if (dateOrderIds.length > 0) {
    ruleFailures.push({
      rule: 'Hire Date / Last Updated order',
      description: 'Hire Date must be on or before Last Updated and not in the future.',
      count: dateOrderIds.length,
      sampleIds: dateOrderIds.slice(0, 10),
    });
  }
  if (engagementOutOfRangeIds.length > 0) {
    ruleFailures.push({
      rule: 'Engagement Score range',
      description: `Engagement Score must sit within 0 to ${engagementScaleMax}.`,
      count: engagementOutOfRangeIds.length,
      sampleIds: engagementOutOfRangeIds.slice(0, 10),
    });
  }
  if (unmappedStatusCounts.size > 0) {
    const count = Array.from(unmappedStatusCounts.values()).reduce((a, b) => a + b, 0);
    ruleFailures.push({
      rule: 'Unrecognised Work Status',
      description: 'Work Status could not be mapped to Present, Remote, Leave, or Absent.',
      count,
      sampleIds: Array.from(unmappedStatusCounts.keys()).slice(0, 10),
    });
  }
  if (staleCount > 0) {
    ruleFailures.push({
      rule: 'Stale employee records',
      description: `Last Updated is more than ${settings.staleDaysThreshold} days older than the latest record.`,
      count: staleCount,
      sampleIds: enrichedEmployees.filter((e) => e.isStale).slice(0, 10).map((e) => e.employeeId),
    });
  }

  return {
    employees: enrichedEmployees,
    engagementScaleMax,
    latestLastUpdated,
    report: {
      overallScore,
      dimensions: {
        completeness,
        validity,
        uniqueness,
        consistency,
        freshness,
      },
      totalRowsRead: rawRows.length,
      validRowsSaved: enrichedEmployees.length,
      rejectedRows,
      duplicatesRemoved: exactDuplicatesRemoved,
      conflictsResolved,
      imputedCellsCount,
      outliersFlaggedCount,
      highMissingColumns,
      ruleFailures,
      cleaningDecisions: Array.from(decisionsMap.values()),
      ambiguousDateAssumption:
        ambiguousDateCount > 0
          ? `${ambiguousDateCount} ambiguous DD/MM vs MM/DD dates were interpreted as UK day-first (DD/MM/YYYY).`
          : 'All dates parsed unambiguously (ISO, Excel serial, or day > 12).',
      unmappedStatuses: Array.from(unmappedStatusCounts.entries()).map(([rawValue, count]) => ({
        rawValue,
        count,
      })),
    },
  };
}

export function reconcileTaskTotals(employees: EmployeeRecord[]): EmployeeRecord[] {
  return employees.map((emp) => {
    if (emp.dataQuality.taskReconciled) return emp;
    const newTotal = emp.completedTasks + emp.pendingTasks + emp.overdueTasks;
    const completionRate = newTotal > 0 ? emp.completedTasks / newTotal : null;
    const issues = emp.dataQuality.issues.filter((i) => i !== 'Task counts do not reconcile');
    return {
      ...emp,
      totalTasks: newTotal,
      completionRate,
      dataQuality: {
        ...emp.dataQuality,
        issues,
        taskReconciled: true,
        fixesApplied: [
          ...emp.dataQuality.fixesApplied,
          {
            field: 'Total Tasks',
            rule: 'One-click task reconciliation',
            from: String(emp.totalTasks),
            to: String(newTotal),
          },
        ],
      },
    };
  });
}
