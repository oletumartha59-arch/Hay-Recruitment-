import type { EmployeeRecord } from '../../types/workforce';

export interface FeatureMatrixSpec {
  featureNames: string[];
  rows: number[][];
  employeeIds: string[];
  rawValuesByFeature: Record<string, number[]>;
}

/**
 * Builds numeric feature matrix strictly excluding:
 * - Employee ID, Employee Name
 * - Protected characteristics (never stored)
 * - Attention Status, Attention Reason, needsAttentionFlag (prevent target leakage)
 * - Risk scores derived from weights
 */
export function buildModelFeatureMatrix(employees: EmployeeRecord[]): FeatureMatrixSpec {
  // Determine categories with >= 10 employees for department & location one-hot
  const deptCounts = new Map<string, number>();
  const locCounts = new Map<string, number>();
  for (const e of employees) {
    deptCounts.set(e.department, (deptCounts.get(e.department) ?? 0) + 1);
    locCounts.set(e.location, (locCounts.get(e.location) ?? 0) + 1);
  }
  const topDepts = Array.from(deptCounts.entries())
    .filter(([, c]) => c >= 10)
    .map(([d]) => d)
    .sort();
  const topLocs = Array.from(locCounts.entries())
    .filter(([, c]) => c >= 10)
    .map(([l]) => l)
    .sort();

  // Compute engagement z-score within peers (>= 5 peers)
  const peerEngStats = new Map<string, { mean: number; std: number; openSorted: number[] }>();
  const buckets = new Map<string, EmployeeRecord[]>();
  for (const e of employees) {
    const key = `${e.department}|||${e.jobLevel}`;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }
  for (const [key, list] of buckets.entries()) {
    const m = list.reduce((a, b) => a + b.engagementPct, 0) / list.length;
    const v = list.reduce((a, b) => a + (b.engagementPct - m) ** 2, 0) / Math.max(1, list.length);
    const openSorted = list.map((x) => x.openTasks).sort((a, b) => a - b);
    peerEngStats.set(key, { mean: m, std: Math.sqrt(v), openSorted });
  }

  const featureNames = [
    'engagementPct',
    'engagementZWithinPeers',
    'tenureMonths',
    'jobLevelRank',
    'completionRate',
    'overdueShare',
    'openTasks',
    'openTasksPercentileWithinGroup',
    'totalTasks',
    'workloadLevelOrdinal',
    'leaveDaysRemaining',
    'leaveToTenureRatio',
    'isStale',
    'signalCount',
    'hasBurnoutPattern',
    'status_Present',
    'status_Remote',
    'status_Leave',
    'status_Absent',
    'arr_Office',
    'arr_Remote',
    'arr_Hybrid',
    ...topDepts.map((d) => `dept_${d}`),
    'dept_Other',
    ...topLocs.map((l) => `loc_${l}`),
    'loc_Other',
  ];

  const rows: number[][] = [];
  const employeeIds: string[] = [];
  const rawValuesByFeature: Record<string, number[]> = {};
  featureNames.forEach((f) => {
    rawValuesByFeature[f] = [];
  });

  for (const emp of employees) {
    const key = `${emp.department}|||${emp.jobLevel}`;
    const peers = peerEngStats.get(key);
    const engZ =
      peers && peers.std > 0 && buckets.get(key)!.length >= 5
        ? (emp.engagementPct - peers.mean) / peers.std
        : 0;
    const openSorted = peers?.openSorted ?? [emp.openTasks];
    const openRank = openSorted.filter((v) => v <= emp.openTasks).length / Math.max(1, openSorted.length);

    const workloadOrd = emp.workloadLevel === 'High' ? 2 : emp.workloadLevel === 'Medium' ? 1 : 0;
    const leaveRatio = emp.tenureMonths > 0 ? emp.leaveDaysRemaining / emp.tenureMonths : 0;
    const hasBurnout = emp.signals.some((s) => s.code === 'burnout_pattern') ? 1 : 0;

    const deptMatch = topDepts.includes(emp.department);
    const locMatch = topLocs.includes(emp.location);

    const row: number[] = [
      emp.engagementPct,
      engZ,
      emp.tenureMonths,
      emp.jobLevelRank,
      emp.completionRate ?? 1,
      emp.overdueShare ?? 0,
      emp.openTasks,
      openRank * 100,
      emp.totalTasks,
      workloadOrd,
      emp.leaveDaysRemaining,
      leaveRatio,
      emp.isStale ? 1 : 0,
      emp.signals.length,
      hasBurnout,
      emp.workStatus === 'Present' ? 1 : 0,
      emp.workStatus === 'Remote' ? 1 : 0,
      emp.workStatus === 'Leave' ? 1 : 0,
      emp.workStatus === 'Absent' ? 1 : 0,
      emp.workArrangement === 'Office' ? 1 : 0,
      emp.workArrangement === 'Remote' ? 1 : 0,
      emp.workArrangement === 'Hybrid' ? 1 : 0,
      ...topDepts.map((d) => (emp.department === d ? 1 : 0)),
      deptMatch ? 0 : 1,
      ...topLocs.map((l) => (emp.location === l ? 1 : 0)),
      locMatch ? 0 : 1,
    ];

    rows.push(row);
    employeeIds.push(emp.employeeId);
    row.forEach((v, idx) => {
      rawValuesByFeature[featureNames[idx]].push(v);
    });
  }

  return { featureNames, rows, employeeIds, rawValuesByFeature };
}
