import { z } from 'zod';
import type {
  EmployeeRecord,
  GlobalFilterState,
  SignalCode,
  TrainedModelSummary,
  UploadSnapshot,
  WorkforceSettings,
} from '../../types/workforce';
import { INITIAL_FILTER_STATE } from '../../types/workforce';
import {
  aggregateByGroup,
  compareTwoGroups,
  computeHeadlineKpis,
  computeSnapshotDiff,
  filterEmployees,
  maskEmployeeName,
  type AggregationMetric,
  type GroupByField,
} from '../metrics';
import { hasSignalType } from '../features/signals';

const FiltersSchema = z
  .object({
    departments: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    workStatuses: z.array(z.string()).optional(),
    jobLevels: z.array(z.string()).optional(),
    workloadLevels: z.array(z.string()).optional(),
    attentionStatuses: z.array(z.string()).optional(),
    riskBands: z.array(z.string()).optional(),
    minOverdueTasks: z.number().optional(),
    minEngagementPct: z.number().optional(),
    maxEngagementPct: z.number().optional(),
    search: z.string().optional(),
    signalType: z.string().optional(),
  })
  .optional();

export interface ToolContext {
  employees: EmployeeRecord[];
  previousEmployees?: EmployeeRecord[];
  engagementScaleMax: number;
  settings: WorkforceSettings;
  privacyMode: boolean;
  includeNamesInAI: boolean;
  activeModel?: TrainedModelSummary;
  snapshots: UploadSnapshot[];
  onNavigateRecommendations?: (scopeType: 'employee' | 'team' | 'company', scopeId: string) => void;
  onTriggerExport?: (reportType: string) => void;
}

export interface ToolExecutionResult {
  toolName: string;
  result: unknown;
  displayPayload?: {
    type: 'table' | 'chart' | 'kpis' | 'employee';
    title: string;
    rows?: Array<Record<string, unknown>>;
    chartSpec?: {
      chartType: string;
      title: string;
      subtitle: string;
      labels: string[];
      values: number[];
      unit: string;
    };
  };
}

function applyToolFilters(employees: EmployeeRecord[], rawFilters?: unknown): EmployeeRecord[] {
  const parsed = FiltersSchema.safeParse(rawFilters);
  if (!parsed.success || !parsed.data) return employees;
  const f = parsed.data;
  const state: GlobalFilterState = {
    ...INITIAL_FILTER_STATE,
    departments: f.departments ?? [],
    locations: f.locations ?? [],
    workStatuses: (f.workStatuses as GlobalFilterState['workStatuses']) ?? [],
    jobLevels: f.jobLevels ?? [],
    workloadLevels: (f.workloadLevels as GlobalFilterState['workloadLevels']) ?? [],
    attentionStatuses: (f.attentionStatuses as GlobalFilterState['attentionStatuses']) ?? [],
    riskBands: (f.riskBands as GlobalFilterState['riskBands']) ?? [],
    search: f.search ?? '',
    engagementRange: [f.minEngagementPct ?? 0, f.maxEngagementPct ?? 100],
    signalTypes: f.signalType ? [f.signalType as SignalCode | 'missed_warning_signs'] : [],
  };
  let list = filterEmployees(employees, state);
  if (f.minOverdueTasks !== undefined) {
    list = list.filter((e) => e.overdueTasks > f.minOverdueTasks!);
  }
  return list;
}

export function executeWorkforceTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): ToolExecutionResult {
  const mask = ctx.privacyMode || !ctx.includeNamesInAI;

  switch (toolName) {
    case 'query_employees': {
      const matched = applyToolFilters(ctx.employees, args.filters);
      const sortBy = typeof args.sortBy === 'string' ? args.sortBy : '-riskScore';
      const desc = sortBy.startsWith('-');
      const field = desc ? sortBy.slice(1) : sortBy;

      const sorted = [...matched].sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[field];
        const bv = (b as unknown as Record<string, unknown>)[field];
        if (typeof av === 'number' && typeof bv === 'number') return desc ? bv - av : av - bv;
        return desc
          ? String(bv ?? '').localeCompare(String(av ?? ''))
          : String(av ?? '').localeCompare(String(bv ?? ''));
      });

      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 20)));
      const rows = sorted.slice(0, limit).map((e) => ({
        employeeId: e.employeeId,
        employeeName: maskEmployeeName(e.employeeName, e.employeeId, mask),
        department: e.department,
        jobLevel: e.jobLevel,
        location: e.location,
        workStatus: e.workStatus,
        engagementScore: `${e.engagementScore}/${ctx.engagementScaleMax}`,
        engagementPct: Math.round(e.engagementPct),
        pendingTasks: e.pendingTasks,
        overdueTasks: e.overdueTasks,
        workloadLevel: e.workloadLevel,
        attentionStatus: e.attentionStatus,
        riskScore: e.riskScore,
        riskBand: e.riskBand,
        signals: e.signals.map((s) => s.label).join(', ') || 'None',
      }));

      return {
        toolName,
        result: { totalMatched: matched.length, returned: rows.length, rows },
        displayPayload: {
          type: 'table',
          title: `Matching Employees (${matched.length} total, showing ${rows.length})`,
          rows,
        },
      };
    }

    case 'aggregate': {
      const matched = applyToolFilters(ctx.employees, args.filters);
      const metric = (args.metric as AggregationMetric) || 'count';
      const groupBy = (args.groupBy as GroupByField) || 'department';
      const agg = (args.agg as 'count' | 'sum' | 'mean' | 'median' | 'rate') || 'mean';
      const rows = aggregateByGroup(matched, metric, groupBy, agg, ctx.settings.smallSampleThreshold)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      return {
        toolName,
        result: { totalEmployeesInScope: matched.length, metric, groupBy, agg, rows },
        displayPayload: {
          type: 'table',
          title: `${metric} (${agg}) by ${groupBy} (n=${matched.length})`,
          rows: rows.map((r) => ({
            group: r.group,
            employees: r.count,
            value: r.value ?? 'n/a',
            sharePct: r.sharePct !== null ? `${r.sharePct}%` : 'n/a',
            note: r.smallSample ? 'Small sample (<5)' : '',
          })),
        },
      };
    }

    case 'compare_groups': {
      const metric = (args.metric as AggregationMetric) || 'engagementPct';
      const gA = (args.groupA as { field: GroupByField; value: string; label?: string }) ?? {
        field: 'workArrangement',
        value: 'Remote',
      };
      const gB = (args.groupB as { field: GroupByField; value: string; label?: string }) ?? {
        field: 'workArrangement',
        value: 'Office',
      };
      const cmp = compareTwoGroups(ctx.employees, metric, gA, gB);
      return {
        toolName,
        result: cmp,
        displayPayload: {
          type: 'table',
          title: `Group Comparison: ${cmp.groupA.label} vs ${cmp.groupB.label} (${metric})`,
          rows: [
            { group: cmp.groupA.label, n: cmp.groupA.n, mean: cmp.groupA.mean ?? 'n/a', median: cmp.groupA.median ?? 'n/a' },
            { group: cmp.groupB.label, n: cmp.groupB.n, mean: cmp.groupB.mean ?? 'n/a', median: cmp.groupB.median ?? 'n/a' },
            { group: 'Difference (A - B)', n: cmp.groupA.n + cmp.groupB.n, mean: cmp.differenceMean ?? 'n/a', median: '-' },
          ],
        },
      };
    }

    case 'get_kpis': {
      const matched = applyToolFilters(ctx.employees, args.filters);
      const kpis = computeHeadlineKpis(matched, ctx.engagementScaleMax, ctx.previousEmployees);
      return {
        toolName,
        result: kpis,
        displayPayload: {
          type: 'kpis',
          title: `Workforce KPIs (${kpis.totalEmployees} employees)`,
          rows: [
            { metric: 'Total Employees', value: kpis.totalEmployees },
            { metric: 'Present', value: `${kpis.present.count} (${kpis.present.sharePct ?? 0}%)` },
            { metric: 'Remote', value: `${kpis.remote.count} (${kpis.remote.sharePct ?? 0}%)` },
            { metric: 'Leave', value: `${kpis.leave.count} (${kpis.leave.sharePct ?? 0}%)` },
            { metric: 'Absent', value: `${kpis.absent.count} (${kpis.absent.sharePct ?? 0}%)` },
            { metric: 'Avg Engagement', value: kpis.avgEngagementPct !== null ? `${kpis.avgEngagementScore}/${kpis.engagementScaleMax} (${kpis.avgEngagementPct}%)` : 'n/a' },
            { metric: 'Needs Attention', value: `${kpis.needsAttention.count} (${kpis.needsAttention.sharePct ?? 0}%)` },
            { metric: 'Pending Tasks', value: kpis.pendingTasks },
            { metric: 'Overdue Tasks', value: kpis.overdueTasks },
          ],
        },
      };
    }

    case 'top_risk_employees': {
      const matched = applyToolFilters(ctx.employees, args.filters);
      const n = Math.min(25, Math.max(1, Number(args.n ?? 10)));
      const top = [...matched]
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, n)
        .map((e) => ({
          employeeId: e.employeeId,
          employeeName: maskEmployeeName(e.employeeName, e.employeeId, mask),
          department: e.department,
          jobLevel: e.jobLevel,
          riskScore: e.riskScore,
          riskBand: e.riskBand,
          topDriver: e.drivers[0] ? `${e.drivers[0].factor} (${e.drivers[0].employeeValue})` : 'None',
          attentionStatus: e.attentionStatus,
        }));
      return {
        toolName,
        result: { count: top.length, employees: top },
        displayPayload: {
          type: 'table',
          title: `Top ${top.length} Highest Risk Employees`,
          rows: top,
        },
      };
    }

    case 'explain_employee': {
      const targetId = String(args.employeeId ?? '').trim().toUpperCase();
      const emp = ctx.employees.find(
        (e) => e.employeeId.toUpperCase() === targetId || e.employeeName.toUpperCase() === targetId
      );
      if (!emp) {
        return {
          toolName,
          result: { found: false, message: `No employee found matching "${targetId}".` },
        };
      }
      const explanation = {
        employeeId: emp.employeeId,
        employeeName: maskEmployeeName(emp.employeeName, emp.employeeId, mask),
        department: emp.department,
        jobLevel: emp.jobLevel,
        location: emp.location,
        workStatus: emp.workStatus,
        engagementPct: Math.round(emp.engagementPct),
        openTasks: emp.openTasks,
        overdueTasks: emp.overdueTasks,
        overdueSharePct: emp.overdueShare !== null ? Math.round(emp.overdueShare * 100) : 0,
        riskScore: emp.riskScore,
        riskBand: emp.riskBand,
        riskRankCompany: emp.riskRankCompany,
        riskRankDepartment: emp.riskRankDepartment,
        signals: emp.signals.map((s) => ({ label: s.label, severity: s.severity, reason: s.reason })),
        drivers: emp.drivers.slice(0, 5),
      };
      return {
        toolName,
        result: explanation,
        displayPayload: {
          type: 'employee',
          title: `Risk Explanation: ${explanation.employeeName}`,
          rows: explanation.drivers.map((d) => ({
            factor: d.factor,
            employeeValue: d.employeeValue,
            peerMedian: d.peerMedian,
            effectPoints: d.effectPoints > 0 ? `+${d.effectPoints}` : `${d.effectPoints}`,
          })),
        },
      };
    }

    case 'warning_signs': {
      const matched = applyToolFilters(ctx.employees, args.filters);
      const sigType = (args.type as SignalCode | 'missed_warning_signs') || 'missed_warning_signs';
      const flagged = matched.filter((e) => hasSignalType(e, sigType));
      const rows = flagged.slice(0, 30).map((e) => ({
        employeeId: e.employeeId,
        employeeName: maskEmployeeName(e.employeeName, e.employeeId, mask),
        department: e.department,
        jobLevel: e.jobLevel,
        engagementPct: `${Math.round(e.engagementPct)}%`,
        overdueTasks: e.overdueTasks,
        workloadLevel: e.workloadLevel,
        attentionStatus: e.attentionStatus,
        riskScore: e.riskScore,
      }));
      return {
        toolName,
        result: { signalType: sigType, count: flagged.length, sample: rows },
        displayPayload: {
          type: 'table',
          title: `Warning Sign "${sigType}" (${flagged.length} employees)`,
          rows,
        },
      };
    }

    case 'trend': {
      const diff = computeSnapshotDiff(ctx.employees, ctx.previousEmployees);
      if (!diff) {
        return {
          toolName,
          result: {
            available: false,
            message: 'Only one snapshot is currently saved. Upload a newer snapshot to compare changes over time.',
          },
        };
      }
      return {
        toolName,
        result: { available: true, ...diff },
        displayPayload: {
          type: 'table',
          title: 'Changes Since Last Upload',
          rows: [
            { change: 'Employees added', count: diff.added },
            { change: 'Employees removed', count: diff.removed },
            { change: 'Work Status changed', count: diff.statusChanged },
            { change: 'Engagement changed (>= 0.5)', count: diff.engagementChanged },
            { change: 'Average Risk Score delta', count: diff.avgRiskDelta ?? 'n/a' },
          ],
        },
      };
    }

    case 'model_summary': {
      return {
        toolName,
        result: {
          activeMode: ctx.settings.activeRiskMode,
          weights: ctx.settings.riskWeights,
          trainedModel: ctx.activeModel
            ? {
                mode: ctx.activeModel.mode,
                bestAlgorithm: ctx.activeModel.bestAlgorithm,
                qualityLabel: ctx.activeModel.qualityLabel,
                qualityReason: ctx.activeModel.qualityReason,
                topDrivers: ctx.activeModel.globalImportance.slice(0, 5),
              }
            : null,
        },
      };
    }

    case 'create_chart': {
      const matched = applyToolFilters(ctx.employees, args.filters);
      const metric = (args.metric as AggregationMetric) || 'pendingTasks';
      const groupBy = (args.groupBy as GroupByField) || 'department';
      const agg = metric === 'pendingTasks' || metric === 'overdueTasks' || metric === 'count' ? 'sum' : 'mean';
      const rows = aggregateByGroup(matched, metric, groupBy, agg, ctx.settings.smallSampleThreshold)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      const chartSpec = {
        chartType: String(args.chartType ?? 'horizontal_bar'),
        title: String(args.title ?? `${metric} by ${groupBy}`),
        subtitle: `${agg === 'sum' ? 'Total' : 'Average'} across ${matched.length} employees`,
        labels: rows.map((r) => r.group),
        values: rows.map((r) => r.value ?? 0),
        unit: metric.includes('Pct') || metric.includes('Rate') || metric.includes('Share') ? '%' : '',
      };

      return {
        toolName,
        result: { chartSpec, rows },
        displayPayload: {
          type: 'chart',
          title: chartSpec.title,
          chartSpec,
          rows: rows.map((r) => ({ group: r.group, value: r.value ?? 0, employees: r.count })),
        },
      };
    }

    case 'generate_recommendations': {
      const scopeType = (args.scopeType as 'employee' | 'team' | 'company') ?? 'company';
      const scopeId = String(args.scopeId ?? 'company');
      ctx.onNavigateRecommendations?.(scopeType, scopeId);
      return {
        toolName,
        result: {
          action: 'Recommendation plan ready',
          scopeType,
          scopeId,
          note: 'Open Recommendations to review and export the full plan.',
        },
      };
    }

    case 'export_report': {
      const reportType = String(args.reportType ?? 'executive_summary');
      ctx.onTriggerExport?.(reportType);
      return {
        toolName,
        result: {
          triggered: true,
          reportType,
        },
      };
    }

    default:
      return {
        toolName,
        result: { error: `Unknown tool "${toolName}"` },
      };
  }
}

/**
 * Extracts numeric tokens from Gemini's explanation and checks each appears in the JSON-serialized tool results.
 * Allows tiny integer indices (1, 2, 3) used for numbered lists or P1/P2/P3 labels.
 */
export function verifyAnswerNumbersAgainstTools(
  answerText: string,
  toolResults: unknown[]
): { valid: boolean; ungroundedNumbers: string[] } {
  const toolBlob = JSON.stringify(toolResults);
  const matches = answerText.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  const ungrounded: string[] = [];

  for (const numStr of matches) {
    // Allow ordinal list numbers 1..5 when followed by '.' at start of line, or 0
    if (toolBlob.includes(numStr)) continue;
    // Also allow rounded integer equivalent of a float in toolBlob (e.g., 64 from 64.2)
    const num = Number(numStr);
    const regexFloat = new RegExp(`\\b${Math.floor(num)}\\.\\d+\\b`);
    if (regexFloat.test(toolBlob)) continue;
    ungrounded.push(numStr);
  }

  return {
    valid: ungrounded.length === 0,
    ungroundedNumbers: Array.from(new Set(ungrounded)),
  };
}

/**
 * Deterministic fallback when Gemini API is unavailable or fails verification twice.
 */
export function buildRuleBasedChatFallback(
  question: string,
  ctx: ToolContext
): {
  text: string;
  toolsUsed: string[];
  dataPayload?: ToolExecutionResult['displayPayload'];
} {
  const q = question.toLowerCase();

  // Guardrails: protected characteristics or dismissal
  if (/\b(age|race|religion|sex|gender|pregnant|pregnancy|disability|fire|dismiss|terminate)\b/.test(q)) {
    return {
      text: 'I cannot rank employees by protected characteristics or recommend dismissal. Hay Recruitment Workforce AI Central only analyses work, task, engagement, and attendance indicators to support fair retention decisions.',
      toolsUsed: [],
    };
  }

  if (q.includes('attrition rate') || q.includes('who will leave')) {
    const hasExit = ctx.employees.some((e) => e.exitTarget !== undefined);
    if (!hasExit) {
      const kpis = executeWorkforceTool('get_kpis', {}, ctx);
      return {
        text: `The uploaded dataset does not contain an exit date or leaver flag column, so an observed attrition rate cannot be calculated. As the closest available measure, ${ctx.employees.filter((e) => e.riskBand === 'High' || e.riskBand === 'Critical').length} employees sit in the High or Critical Retention Risk Index bands, and ${(kpis.result as { warningCounts: { missedWarningSigns: number } }).warningCounts.missedWarningSigns} employees have active warning signs missed by current HR flags.`,
        toolsUsed: ['get_kpis'],
        dataPayload: kpis.displayPayload,
      };
    }
  }

  // Match example queries deterministically
  if (q.includes('leave') && q.includes('manchester')) {
    const res = executeWorkforceTool(
      'query_employees',
      { filters: { locations: ['Manchester'], workStatuses: ['Leave'] }, limit: 50 },
      ctx
    );
    const r = res.result as { totalMatched: number };
    return {
      text: `There are ${r.totalMatched} employees on Leave in Manchester.`,
      toolsUsed: ['query_employees'],
      dataPayload: res.displayPayload,
    };
  }

  if (q.includes('lowest') && q.includes('engagement')) {
    const res = executeWorkforceTool(
      'aggregate',
      { metric: 'engagementPct', groupBy: 'department', agg: 'mean' },
      ctx
    );
    const rows = (res.result as { rows: Array<{ group: string; value: number | null; count: number }> }).rows;
    const sorted = [...rows].filter((r) => r.value !== null).sort((a, b) => a.value! - b.value!);
    const lowest = sorted[0];
    return {
      text: lowest
        ? `${lowest.group} has the lowest average engagement at ${lowest.value}% of scale across ${lowest.count} employees.`
        : 'No department engagement records match the current dataset.',
      toolsUsed: ['aggregate'],
      dataPayload: res.displayPayload,
    };
  }

  if (q.includes('burnout') && (q.includes('not flagged') || q.includes('ok'))) {
    const res = executeWorkforceTool(
      'warning_signs',
      { type: 'burnout_pattern', filters: { attentionStatuses: ['OK'] } },
      ctx
    );
    const r = res.result as { count: number };
    return {
      text: `${r.count} employees show a burnout pattern (heavy workload paired with low engagement) while their Attention Status is still OK.`,
      toolsUsed: ['warning_signs'],
      dataPayload: res.displayPayload,
    };
  }

  if (q.includes('compare') && q.includes('remote') && q.includes('office')) {
    const eng = executeWorkforceTool(
      'compare_groups',
      {
        metric: 'engagementPct',
        groupA: { field: 'workArrangement', value: 'Remote', label: 'Remote' },
        groupB: { field: 'workArrangement', value: 'Office', label: 'Office' },
      },
      ctx
    );
    const ov = executeWorkforceTool(
      'compare_groups',
      {
        metric: 'overdueTasks',
        groupA: { field: 'workArrangement', value: 'Remote', label: 'Remote' },
        groupB: { field: 'workArrangement', value: 'Office', label: 'Office' },
      },
      ctx
    );
    const eRes = eng.result as { groupA: { n: number; mean: number | null }; groupB: { n: number; mean: number | null } };
    const oRes = ov.result as { groupA: { mean: number | null }; groupB: { mean: number | null } };
    return {
      text: `Remote staff (n=${eRes.groupA.n}) average ${eRes.groupA.mean ?? 'n/a'}% engagement and ${oRes.groupA.mean ?? 'n/a'} overdue tasks, compared with Office staff (n=${eRes.groupB.n}) averaging ${eRes.groupB.mean ?? 'n/a'}% engagement and ${oRes.groupB.mean ?? 'n/a'} overdue tasks.`,
      toolsUsed: ['compare_groups'],
      dataPayload: eng.displayPayload,
    };
  }

  if (q.includes('pending tasks') && q.includes('department')) {
    const chart = executeWorkforceTool(
      'create_chart',
      { chartType: 'horizontal_bar', metric: 'pendingTasks', groupBy: 'department', title: 'Pending Tasks by Department' },
      ctx
    );
    return {
      text: 'Here are total Pending Tasks grouped by Department across the active workforce.',
      toolsUsed: ['create_chart'],
      dataPayload: chart.displayPayload,
    };
  }

  if (q.includes('changed') || q.includes('last upload')) {
    const tr = executeWorkforceTool('trend', {}, ctx);
    const r = tr.result as { available: boolean; message?: string; added?: number; removed?: number; statusChanged?: number; engagementChanged?: number };
    return {
      text: r.available
        ? `Since the previous snapshot: ${r.added} employees added, ${r.removed} removed, ${r.statusChanged} changed work status, and ${r.engagementChanged} changed engagement score.`
        : r.message ?? 'No previous snapshot available for comparison.',
      toolsUsed: ['trend'],
      dataPayload: tr.displayPayload,
    };
  }

  const empMatch = question.match(/\b([A-Z]{1,4}\d{3,6})\b/i);
  if (empMatch) {
    const ex = executeWorkforceTool('explain_employee', { employeeId: empMatch[1].toUpperCase() }, ctx);
    const r = ex.result as { found?: boolean; employeeId?: string; riskScore?: number; riskBand?: string; engagementPct?: number; overdueSharePct?: number };
    if (r.found !== false && r.employeeId) {
      return {
        text: `Employee ${r.employeeId} has a Retention Risk score of ${r.riskScore} (${r.riskBand}), with ${r.engagementPct}% engagement and ${r.overdueSharePct}% of open tasks overdue.`,
        toolsUsed: ['explain_employee'],
        dataPayload: ex.displayPayload,
      };
    }
  }

  // Default KPI summary
  const kpis = executeWorkforceTool('get_kpis', {}, ctx);
  const k = kpis.result as ReturnType<typeof computeHeadlineKpis>;
  return {
    text: `Workforce summary across ${k.totalEmployees} employees: ${k.present.count} Present, ${k.remote.count} Remote, ${k.leave.count} on Leave, ${k.absent.count} Absent. Average engagement is ${k.avgEngagementPct ?? 'n/a'}%, ${k.needsAttention.count} employees are flagged Needs Attention, and ${k.warningCounts.missedWarningSigns} additional employees have computed warning signs.`,
    toolsUsed: ['get_kpis'],
    dataPayload: kpis.displayPayload,
  };
}
