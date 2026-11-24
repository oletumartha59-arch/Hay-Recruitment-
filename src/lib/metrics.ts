import type {
  EmployeeRecord,
  GlobalFilterState,
  SignalCode,
  WorkforceSettings,
} from '../types/workforce';
import { hasSignalType, mean, median } from './features/signals';

export interface HeadlineKpis {
  totalEmployees: number;
  present: { count: number; sharePct: number | null };
  remote: { count: number; sharePct: number | null };
  leave: { count: number; sharePct: number | null };
  absent: { count: number; sharePct: number | null };
  unmappedStatusCount: number;
  statusReconciles: boolean;
  avgEngagementScore: number | null;
  avgEngagementPct: number | null;
  engagementScaleMax: number;
  engagementDeltaPct: number | null;
  needsAttention: { count: number; sharePct: number | null; additionalSignalCount: number };
  pendingTasks: number;
  overdueTasks: number;
  warningCounts: {
    lowEngagement: number;
    heavyWorkload: number;
    burnoutPattern: number;
    missedWarningSigns: number;
    flaggedWithoutSignal: number;
  };
}

export function getTenureBand(tenureMonths: number): string {
  if (tenureMonths < 6) return 'Under 6 months';
  if (tenureMonths < 12) return '6 to 12 months';
  if (tenureMonths < 36) return '1 to 3 years';
  if (tenureMonths < 60) return '3 to 5 years';
  return 'Over 5 years';
}

export const TENURE_BAND_ORDER = [
  'Under 6 months',
  '6 to 12 months',
  '1 to 3 years',
  '3 to 5 years',
  'Over 5 years',
];

export function filterEmployees(
  employees: EmployeeRecord[],
  filters: GlobalFilterState
): EmployeeRecord[] {
  const searchLower = filters.search.trim().toLowerCase();

  return employees.filter((emp) => {
    if (filters.departments.length > 0 && !filters.departments.includes(emp.department)) return false;
    if (filters.locations.length > 0 && !filters.locations.includes(emp.location)) return false;
    if (filters.workStatuses.length > 0 && !filters.workStatuses.includes(emp.workStatus)) return false;
    if (filters.jobLevels.length > 0 && !filters.jobLevels.includes(emp.jobLevel)) return false;
    if (filters.workArrangements.length > 0 && !filters.workArrangements.includes(emp.workArrangement)) return false;
    if (filters.workloadLevels.length > 0 && !filters.workloadLevels.includes(emp.workloadLevel)) return false;
    if (filters.attentionStatuses.length > 0 && !filters.attentionStatuses.includes(emp.attentionStatus)) return false;
    if (filters.riskBands.length > 0 && !filters.riskBands.includes(emp.riskBand)) return false;
    if (filters.tenureBands.length > 0 && !filters.tenureBands.includes(getTenureBand(emp.tenureMonths))) return false;
    if (filters.staleOnly && !emp.isStale) return false;
    if (
      emp.engagementPct < filters.engagementRange[0] ||
      emp.engagementPct > filters.engagementRange[1]
    ) {
      return false;
    }
    if (filters.signalTypes.length > 0) {
      const matchesAnySignal = filters.signalTypes.some((sig) => hasSignalType(emp, sig));
      if (!matchesAnySignal) return false;
    }
    if (searchLower) {
      const hay = `${emp.employeeId} ${emp.employeeName} ${emp.department} ${emp.location} ${emp.jobLevel} ${emp.attentionReason}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });
}

export function getCascadingFilterCounts(
  allEmployees: EmployeeRecord[],
  filters: GlobalFilterState
): {
  departments: Array<{ value: string; count: number }>;
  locations: Array<{ value: string; count: number }>;
  workStatuses: Array<{ value: EmployeeRecord['workStatus']; count: number }>;
  jobLevels: Array<{ value: string; count: number }>;
  workArrangements: Array<{ value: EmployeeRecord['workArrangement']; count: number }>;
  workloadLevels: Array<{ value: EmployeeRecord['workloadLevel']; count: number }>;
  attentionStatuses: Array<{ value: EmployeeRecord['attentionStatus']; count: number }>;
  riskBands: Array<{ value: EmployeeRecord['riskBand']; count: number }>;
} {
  const without = (omitKey: keyof GlobalFilterState) =>
    filterEmployees(allEmployees, { ...filters, [omitKey]: [] });

  const countBy = <T extends string>(
    list: EmployeeRecord[],
    getter: (e: EmployeeRecord) => T
  ): Array<{ value: T; count: number }> => {
    const map = new Map<T, number>();
    for (const e of list) {
      const k = getter(e);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  };

  return {
    departments: countBy(without('departments'), (e) => e.department),
    locations: countBy(without('locations'), (e) => e.location),
    workStatuses: countBy(without('workStatuses'), (e) => e.workStatus),
    jobLevels: countBy(without('jobLevels'), (e) => e.jobLevel),
    workArrangements: countBy(without('workArrangements'), (e) => e.workArrangement),
    workloadLevels: countBy(without('workloadLevels'), (e) => e.workloadLevel),
    attentionStatuses: countBy(without('attentionStatuses'), (e) => e.attentionStatus),
    riskBands: countBy(without('riskBands'), (e) => e.riskBand),
  };
}

export function computeHeadlineKpis(
  employees: EmployeeRecord[],
  engagementScaleMax: number,
  previousEmployees?: EmployeeRecord[]
): HeadlineKpis {
  const total = employees.length;
  const pct = (count: number) => (total > 0 ? Math.round((count / total) * 1000) / 10 : null);

  let present = 0;
  let remote = 0;
  let leave = 0;
  let absent = 0;
  let unmapped = 0;
  let needsAttention = 0;
  let additionalSignals = 0;
  let pendingTasks = 0;
  let overdueTasks = 0;
  let lowEngagement = 0;
  let heavyWorkload = 0;
  let burnoutPattern = 0;
  let missedWarningSigns = 0;
  let flaggedWithoutSignal = 0;

  for (const e of employees) {
    if (e.workStatus === 'Present') present += 1;
    else if (e.workStatus === 'Remote') remote += 1;
    else if (e.workStatus === 'Leave') leave += 1;
    else if (e.workStatus === 'Absent') absent += 1;
    else unmapped += 1;

    if (e.needsAttentionFlag) needsAttention += 1;
    if (e.missedByCurrentProcess) {
      additionalSignals += 1;
      missedWarningSigns += 1;
    }
    if (e.flaggedWithoutSignal) flaggedWithoutSignal += 1;

    pendingTasks += e.pendingTasks;
    overdueTasks += e.overdueTasks;

    if (
      e.signals.some((s) => s.code === 'low_engagement' || s.code === 'critical_engagement')
    ) {
      lowEngagement += 1;
    }
    if (e.signals.some((s) => s.code === 'heavy_workload' || s.code === 'severe_overload')) {
      heavyWorkload += 1;
    }
    if (e.signals.some((s) => s.code === 'burnout_pattern')) {
      burnoutPattern += 1;
    }
  }

  const avgEngagementScore =
    total > 0 ? Math.round(mean(employees.map((e) => e.engagementScore)) * 10) / 10 : null;
  const avgEngagementPct =
    total > 0 ? Math.round(mean(employees.map((e) => e.engagementPct)) * 10) / 10 : null;

  let engagementDeltaPct: number | null = null;
  if (previousEmployees && previousEmployees.length > 0 && avgEngagementPct !== null) {
    const prevAvgPct = mean(previousEmployees.map((e) => e.engagementPct));
    engagementDeltaPct = Math.round((avgEngagementPct - prevAvgPct) * 10) / 10;
  }

  return {
    totalEmployees: total,
    present: { count: present, sharePct: pct(present) },
    remote: { count: remote, sharePct: pct(remote) },
    leave: { count: leave, sharePct: pct(leave) },
    absent: { count: absent, sharePct: pct(absent) },
    unmappedStatusCount: unmapped,
    statusReconciles: present + remote + leave + absent === total,
    avgEngagementScore,
    avgEngagementPct,
    engagementScaleMax,
    engagementDeltaPct,
    needsAttention: {
      count: needsAttention,
      sharePct: pct(needsAttention),
      additionalSignalCount: additionalSignals,
    },
    pendingTasks,
    overdueTasks,
    warningCounts: {
      lowEngagement,
      heavyWorkload,
      burnoutPattern,
      missedWarningSigns,
      flaggedWithoutSignal,
    },
  };
}

export type AggregationMetric =
  | 'count'
  | 'engagementPct'
  | 'engagementScore'
  | 'pendingTasks'
  | 'overdueTasks'
  | 'totalTasks'
  | 'completedTasks'
  | 'completionRate'
  | 'overdueShare'
  | 'leaveDaysRemaining'
  | 'riskScore'
  | 'needsAttentionRate'
  | 'staleRate';

export type GroupByField =
  | 'department'
  | 'location'
  | 'jobLevel'
  | 'workStatus'
  | 'workArrangement'
  | 'workloadLevel'
  | 'attentionStatus'
  | 'riskBand'
  | 'tenureBand';

export function getGroupValue(emp: EmployeeRecord, groupBy: GroupByField): string {
  switch (groupBy) {
    case 'tenureBand':
      return getTenureBand(emp.tenureMonths);
    default:
      return String(emp[groupBy]);
  }
}

export function getNumericMetricValue(emp: EmployeeRecord, metric: AggregationMetric): number | null {
  switch (metric) {
    case 'count':
      return 1;
    case 'engagementPct':
      return emp.engagementPct;
    case 'engagementScore':
      return emp.engagementScore;
    case 'pendingTasks':
      return emp.pendingTasks;
    case 'overdueTasks':
      return emp.overdueTasks;
    case 'totalTasks':
      return emp.totalTasks;
    case 'completedTasks':
      return emp.completedTasks;
    case 'completionRate':
      return emp.completionRate !== null ? emp.completionRate * 100 : null;
    case 'overdueShare':
      return emp.overdueShare !== null ? emp.overdueShare * 100 : null;
    case 'leaveDaysRemaining':
      return emp.leaveDaysRemaining;
    case 'riskScore':
      return emp.riskScore;
    case 'needsAttentionRate':
      return emp.needsAttentionFlag ? 100 : 0;
    case 'staleRate':
      return emp.isStale ? 100 : 0;
  }
}

export interface AggregatedRow {
  group: string;
  count: number;
  value: number | null;
  sharePct: number | null;
  smallSample: boolean;
}

export function aggregateByGroup(
  employees: EmployeeRecord[],
  metric: AggregationMetric,
  groupBy: GroupByField,
  agg: 'count' | 'sum' | 'mean' | 'median' | 'rate' = 'mean',
  smallSampleThreshold = 5
): AggregatedRow[] {
  const buckets = new Map<string, EmployeeRecord[]>();
  for (const emp of employees) {
    const k = getGroupValue(emp, groupBy);
    const list = buckets.get(k);
    if (list) list.push(emp);
    else buckets.set(k, [emp]);
  }

  const totalCount = employees.length;
  const rows: AggregatedRow[] = [];

  for (const [group, list] of buckets.entries()) {
    const count = list.length;
    const sharePct = totalCount > 0 ? Math.round((count / totalCount) * 1000) / 10 : null;
    let value: number | null = null;

    if (metric === 'count' || agg === 'count') {
      value = count;
    } else {
      const vals = list
        .map((e) => getNumericMetricValue(e, metric))
        .filter((v): v is number => v !== null);
      if (vals.length > 0) {
        if (agg === 'sum') value = Math.round(vals.reduce((a, b) => a + b, 0) * 10) / 10;
        else if (agg === 'median') value = Math.round(median(vals) * 10) / 10;
        else value = Math.round(mean(vals) * 10) / 10;
      }
    }

    rows.push({
      group,
      count,
      value,
      sharePct,
      smallSample: count < smallSampleThreshold,
    });
  }

  return rows;
}

export function compareTwoGroups(
  employees: EmployeeRecord[],
  metric: AggregationMetric,
  groupA: { field: GroupByField; value: string; label?: string },
  groupB: { field: GroupByField; value: string; label?: string }
): {
  metric: AggregationMetric;
  groupA: { label: string; n: number; mean: number | null; median: number | null };
  groupB: { label: string; n: number; mean: number | null; median: number | null };
  differenceMean: number | null;
} {
  const listA = employees.filter(
    (e) => getGroupValue(e, groupA.field).toLowerCase() === groupA.value.toLowerCase()
  );
  const listB = employees.filter(
    (e) => getGroupValue(e, groupB.field).toLowerCase() === groupB.value.toLowerCase()
  );

  const valsA = listA
    .map((e) => getNumericMetricValue(e, metric))
    .filter((v): v is number => v !== null);
  const valsB = listB
    .map((e) => getNumericMetricValue(e, metric))
    .filter((v): v is number => v !== null);

  const meanA = valsA.length > 0 ? Math.round(mean(valsA) * 10) / 10 : null;
  const meanB = valsB.length > 0 ? Math.round(mean(valsB) * 10) / 10 : null;

  return {
    metric,
    groupA: {
      label: groupA.label ?? groupA.value,
      n: listA.length,
      mean: meanA,
      median: valsA.length > 0 ? Math.round(median(valsA) * 10) / 10 : null,
    },
    groupB: {
      label: groupB.label ?? groupB.value,
      n: listB.length,
      mean: meanB,
      median: valsB.length > 0 ? Math.round(median(valsB) * 10) / 10 : null,
    },
    differenceMean:
      meanA !== null && meanB !== null ? Math.round((meanA - meanB) * 10) / 10 : null,
  };
}

export function computeSnapshotDiff(
  current: EmployeeRecord[],
  previous?: EmployeeRecord[]
): {
  added: number;
  removed: number;
  statusChanged: number;
  engagementChanged: number;
  avgRiskDelta: number | null;
} | null {
  if (!previous || previous.length === 0) return null;
  const prevMap = new Map(previous.map((e) => [e.employeeId, e]));
  const currMap = new Map(current.map((e) => [e.employeeId, e]));

  let added = 0;
  let statusChanged = 0;
  let engagementChanged = 0;

  for (const emp of current) {
    const prev = prevMap.get(emp.employeeId);
    if (!prev) {
      added += 1;
    } else {
      if (prev.workStatus !== emp.workStatus) statusChanged += 1;
      if (Math.abs(prev.engagementScore - emp.engagementScore) >= 0.5) engagementChanged += 1;
    }
  }

  let removed = 0;
  for (const prev of previous) {
    if (!currMap.has(prev.employeeId)) removed += 1;
  }

  const currRisk = current.length > 0 ? mean(current.map((e) => e.riskScore)) : null;
  const prevRisk = previous.length > 0 ? mean(previous.map((e) => e.riskScore)) : null;
  const avgRiskDelta =
    currRisk !== null && prevRisk !== null ? Math.round((currRisk - prevRisk) * 10) / 10 : null;

  return { added, removed, statusChanged, engagementChanged, avgRiskDelta };
}

export function getTopAttentionReasonTags(
  employees: EmployeeRecord[],
  limit = 10
): Array<{ tag: string; count: number; mappedSignal: SignalCode | null }> {
  const counts = new Map<string, number>();
  for (const e of employees) {
    for (const tag of e.attentionReasonTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const mapTagToSignal = (tag: string): SignalCode | null => {
    const l = tag.toLowerCase();
    if (l.includes('burnout')) return 'burnout_pattern';
    if (l.includes('engagement') || l.includes('morale')) return 'low_engagement';
    if (l.includes('overload') || l.includes('workload') || l.includes('capacity')) return 'heavy_workload';
    if (l.includes('overdue') || l.includes('deadline') || l.includes('delivery')) return 'delivery_slippage';
    if (l.includes('leave') || l.includes('holiday')) return 'unused_leave';
    if (l.includes('absent') || l.includes('attendance')) return 'low_presence';
    if (l.includes('onboarding') || l.includes('tenure')) return 'early_tenure_risk';
    return null;
  };

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count, mappedSignal: mapTagToSignal(tag) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function maskEmployeeName(name: string, employeeId: string, privacyMode: boolean): string {
  if (!privacyMode) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}. (${employeeId})`;
  }
  return `${parts[0]?.charAt(0) ?? 'E'}. (${employeeId})`;
}

export function generateDeptEngagementInsight(
  employees: EmployeeRecord[],
  settings: WorkforceSettings
): string {
  if (employees.length === 0) return 'No employees match the active filters.';
  const companyAvg = Math.round(mean(employees.map((e) => e.engagementPct)) * 10) / 10;
  const byDept = aggregateByGroup(employees, 'engagementPct', 'department', 'mean', settings.smallSampleThreshold)
    .filter((d) => d.value !== null && !d.smallSample)
    .sort((a, b) => (a.value ?? 100) - (b.value ?? 100));

  if (byDept.length === 0) {
    return `Company average engagement is ${companyAvg}% of scale across ${employees.length} employees.`;
  }
  const lowest = byDept[0];
  const gap = Math.round((companyAvg - (lowest.value ?? companyAvg)) * 10) / 10;
  if (gap > 0) {
    return `Engagement is lowest in ${lowest.group} at ${lowest.value}% of scale, ${gap} points below the selection average (${companyAvg}%).`;
  }
  return `All departments sit at or near the selection average of ${companyAvg}% engagement.`;
}
