import type {
  EmployeeRecord,
  RiskBand,
  RiskDriver,
  SignalCode,
  WarningSignal,
  WorkforceSettings,
} from '../../types/workforce';

export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return quantile(s, 50);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function getRiskBand(score: number): RiskBand {
  if (score >= 75) return 'Critical';
  if (score >= 55) return 'High';
  if (score >= 30) return 'Medium';
  return 'Low';
}

export function computeTenureRisk(tenureMonths: number, settings: WorkforceSettings): number {
  const early = settings.tenureRiskEarlyMonths;
  const plateau = settings.tenureRiskPlateauMonths;
  if (tenureMonths <= early) {
    // High early onboarding risk: 75 down to 45
    return Math.round(75 - (tenureMonths / Math.max(1, early)) * 30);
  }
  if (tenureMonths >= plateau) {
    // Rising stagnation risk after 36 months: 45 up to 80 at 72+ months
    const extra = Math.min(36, tenureMonths - plateau);
    return Math.round(45 + (extra / 36) * 35);
  }
  // Mid-tenure settled band: 15..30
  return 20;
}

export function computeCompositeScores(
  params: {
    engagementPct: number;
    workloadLevel: 'Low' | 'Medium' | 'High';
    openTasksPercentile: number;
    overdueShare: number | null;
    completionRate: number | null;
    tenureMonths: number;
  },
  settings: WorkforceSettings
): {
  engagementRisk: number;
  workloadPressure: number;
  deliveryRisk: number;
  tenureRisk: number;
  riskScore: number;
  riskBand: RiskBand;
} {
  const engagementRisk = Math.max(0, Math.min(100, 100 - params.engagementPct));

  const workloadOrdinalScore =
    params.workloadLevel === 'High' ? 100 : params.workloadLevel === 'Medium' ? 50 : 10;
  const overduePct = (params.overdueShare ?? 0) * 100;
  const workloadPressure = Math.max(
    0,
    Math.min(
      100,
      0.4 * workloadOrdinalScore + 0.3 * params.openTasksPercentile + 0.3 * overduePct
    )
  );

  const compPct = (params.completionRate ?? 1) * 100;
  const rawDelivery = (100 - compPct) * (0.5 + 0.5 * (params.overdueShare ?? 0));
  const deliveryRisk = Math.max(0, Math.min(100, rawDelivery));

  const tenureRisk = computeTenureRisk(params.tenureMonths, settings);

  const w = settings.riskWeights;
  const totalWeight = w.engagement + w.workload + w.delivery + w.tenure || 100;
  const weighted =
    (engagementRisk * w.engagement +
      workloadPressure * w.workload +
      deliveryRisk * w.delivery +
      tenureRisk * w.tenure) /
    totalWeight;

  const riskScore = Math.round(Math.max(0, Math.min(100, weighted)));
  return {
    engagementRisk: Math.round(engagementRisk),
    workloadPressure: Math.round(workloadPressure),
    deliveryRisk: Math.round(deliveryRisk),
    tenureRisk: Math.round(tenureRisk),
    riskScore,
    riskBand: getRiskBand(riskScore),
  };
}

interface PeerStats {
  engagementValues: number[];
  engagementMean: number;
  engagementStd: number;
  engagementMedian: number;
  openTasksSorted: number[];
  openTasksP75: number;
  openTasksMedian: number;
  overdueShareMedian: number;
  completionRateMedian: number;
  leaveMedian: number;
  peerCount: number;
}

export function enrichSignalsAndScores(
  employees: EmployeeRecord[],
  settings: WorkforceSettings,
  previousSnapshotEmployees?: EmployeeRecord[]
): EmployeeRecord[] {
  if (employees.length === 0) return [];

  const prevScoreMap = new Map<string, number>();
  if (previousSnapshotEmployees) {
    for (const prev of previousSnapshotEmployees) {
      prevScoreMap.set(prev.employeeId, prev.riskScore);
    }
  }

  // Group stats by Department + JobLevel
  const groupMap = new Map<string, EmployeeRecord[]>();
  for (const emp of employees) {
    const key = `${emp.department}|||${emp.jobLevel}`;
    const arr = groupMap.get(key);
    if (arr) arr.push(emp);
    else groupMap.set(key, [emp]);
  }

  const allLeaveSorted = employees.map((e) => e.leaveDaysRemaining).sort((a, b) => a - b);
  const leaveP75Company = quantile(allLeaveSorted, settings.unusedLeavePercentile);
  const allOpenTasksSorted = employees.map((e) => e.openTasks).sort((a, b) => a - b);
  const companyEngagementMedian = median(employees.map((e) => e.engagementPct));
  const companyOpenMedian = median(employees.map((e) => e.openTasks));
  const companyOverdueMedian = median(employees.map((e) => (e.overdueShare ?? 0) * 100));
  const companyCompletionMedian = median(employees.map((e) => (e.completionRate ?? 1) * 100));

  const peerStatsByKey = new Map<string, PeerStats>();
  for (const [key, group] of groupMap.entries()) {
    const engVals = group.map((e) => e.engagementPct);
    const openSorted = group.map((e) => e.openTasks).sort((a, b) => a - b);
    peerStatsByKey.set(key, {
      engagementValues: engVals,
      engagementMean: mean(engVals),
      engagementStd: stdDev(engVals),
      engagementMedian: median(engVals),
      openTasksSorted: openSorted,
      openTasksP75: quantile(openSorted, settings.heavyWorkloadPercentile),
      openTasksMedian: median(openSorted),
      overdueShareMedian: median(group.map((e) => (e.overdueShare ?? 0) * 100)),
      completionRateMedian: median(group.map((e) => (e.completionRate ?? 1) * 100)),
      leaveMedian: median(group.map((e) => e.leaveDaysRemaining)),
      peerCount: group.length,
    });
  }

  const enriched = employees.map((emp) => {
    const key = `${emp.department}|||${emp.jobLevel}`;
    const peers = peerStatsByKey.get(key)!;
    const hasEnoughPeers = peers.peerCount >= settings.smallSampleThreshold;

    const openRefSorted = hasEnoughPeers ? peers.openTasksSorted : allOpenTasksSorted;
    const rankBelow = openRefSorted.filter((v) => v <= emp.openTasks).length;
    const openTasksPercentile =
      openRefSorted.length > 0 ? Math.round((rankBelow / openRefSorted.length) * 100) : 50;

    const signals: WarningSignal[] = [];

    // 1. Critically low engagement (< 40%) vs Low engagement (< 60%)
    if (emp.engagementPct < settings.criticalEngagementPct) {
      signals.push({
        code: 'critical_engagement',
        label: 'Critically low engagement',
        severity: 'Critical',
        reason: `Engagement is ${emp.engagementPct.toFixed(0)}% of scale (below ${settings.criticalEngagementPct}% critical threshold).`,
        actualValue: `${emp.engagementPct.toFixed(0)}%`,
        thresholdValue: `< ${settings.criticalEngagementPct}%`,
      });
    } else if (emp.engagementPct < settings.lowEngagementPct) {
      signals.push({
        code: 'low_engagement',
        label: 'Low engagement',
        severity: 'Warning',
        reason: `Engagement is ${emp.engagementPct.toFixed(0)}% of scale (below ${settings.lowEngagementPct}% warning threshold).`,
        actualValue: `${emp.engagementPct.toFixed(0)}%`,
        thresholdValue: `< ${settings.lowEngagementPct}%`,
      });
    }

    // 2. Engagement vs peers (>1 SD below Dept+Level mean when >= 5 peers)
    if (
      hasEnoughPeers &&
      peers.engagementStd > 0 &&
      emp.engagementPct < peers.engagementMean - peers.engagementStd
    ) {
      signals.push({
        code: 'engagement_vs_peers',
        label: 'Engagement below peers',
        severity: 'Warning',
        reason: `Engagement (${emp.engagementPct.toFixed(0)}%) is more than 1 SD below the ${emp.department} ${emp.jobLevel} mean (${peers.engagementMean.toFixed(0)}%).`,
        actualValue: `${emp.engagementPct.toFixed(0)}%`,
        thresholdValue: `< ${(peers.engagementMean - peers.engagementStd).toFixed(0)}%`,
      });
    }

    // 3. Heavy workload & Severe overload
    const overduePct = (emp.overdueShare ?? 0) * 100;
    const heavyByLevel = emp.workloadLevel === 'High';
    const heavyByOpenTasks =
      hasEnoughPeers && emp.openTasks > peers.openTasksP75 && emp.openTasks > 0;
    const heavyByOverdue =
      emp.overdueShare !== null && overduePct >= settings.heavyWorkloadOverduePct;
    const isHeavyWorkload = heavyByLevel || heavyByOpenTasks || heavyByOverdue;

    if (isHeavyWorkload && emp.overdueShare !== null && overduePct >= settings.severeOverloadOverduePct) {
      signals.push({
        code: 'severe_overload',
        label: 'Severe overload',
        severity: 'Critical',
        reason: `Heavy workload combined with ${overduePct.toFixed(0)}% of open tasks overdue (threshold ${settings.severeOverloadOverduePct}%).`,
        actualValue: `${overduePct.toFixed(0)}% overdue`,
        thresholdValue: `>= ${settings.severeOverloadOverduePct}%`,
      });
    } else if (isHeavyWorkload) {
      const reasons: string[] = [];
      if (heavyByLevel) reasons.push('Workload Level is High');
      if (heavyByOpenTasks) reasons.push(`open tasks (${emp.openTasks}) above peer P75 (${peers.openTasksP75.toFixed(0)})`);
      if (heavyByOverdue) reasons.push(`overdue share (${overduePct.toFixed(0)}%) >= ${settings.heavyWorkloadOverduePct}%`);
      signals.push({
        code: 'heavy_workload',
        label: 'Heavy workload',
        severity: 'Warning',
        reason: `Heavy workload triggered by: ${reasons.join('; ')}.`,
        actualValue: `${emp.openTasks} open / ${overduePct.toFixed(0)}% overdue`,
        thresholdValue: `${settings.heavyWorkloadOverduePct}% overdue or High load`,
      });
    }

    // 4. Delivery slippage
    if (
      emp.totalTasks >= settings.deliverySlippageMinTasks &&
      emp.completionRate !== null &&
      emp.completionRate * 100 < settings.deliverySlippagePct
    ) {
      signals.push({
        code: 'delivery_slippage',
        label: 'Delivery slippage',
        severity: 'Warning',
        reason: `Completion rate is ${(emp.completionRate * 100).toFixed(0)}% across ${emp.totalTasks} tasks (below ${settings.deliverySlippagePct}%).`,
        actualValue: `${(emp.completionRate * 100).toFixed(0)}%`,
        thresholdValue: `< ${settings.deliverySlippagePct}%`,
      });
    }

    // 5. Burnout pattern (heavy workload + low engagement)
    const hasLowEng = emp.engagementPct < settings.lowEngagementPct;
    if (isHeavyWorkload && hasLowEng) {
      signals.push({
        code: 'burnout_pattern',
        label: 'Burnout pattern',
        severity: 'Critical',
        reason: `Combined heavy workload and low engagement (${emp.engagementPct.toFixed(0)}%).`,
        actualValue: `${emp.engagementPct.toFixed(0)}% eng + heavy load`,
        thresholdValue: `< ${settings.lowEngagementPct}% eng & heavy load`,
      });
    }

    // 6. Unused leave
    if (
      emp.leaveDaysRemaining > leaveP75Company &&
      emp.tenureMonths > settings.unusedLeaveMinTenureMonths
    ) {
      signals.push({
        code: 'unused_leave',
        label: 'Unused leave',
        severity: 'Watch',
        reason: `${emp.leaveDaysRemaining} leave days remaining (above company P${settings.unusedLeavePercentile}: ${leaveP75Company.toFixed(0)}) with ${emp.tenureMonths.toFixed(0)} months tenure.`,
        actualValue: `${emp.leaveDaysRemaining} days`,
        thresholdValue: `> ${leaveP75Company.toFixed(0)} days`,
      });
    }

    // 7. Low presence
    if (emp.workStatus === 'Absent') {
      signals.push({
        code: 'low_presence',
        label: 'Low presence',
        severity: 'Watch',
        reason: 'Current Work Status is Absent.',
        actualValue: 'Absent',
        thresholdValue: 'Present / Remote',
      });
    }

    // 8. Stale record
    if (emp.isStale) {
      signals.push({
        code: 'stale_record',
        label: 'Stale record',
        severity: 'Data warning',
        reason: `Record last updated ${emp.daysSinceUpdated} days ago (threshold ${settings.staleDaysThreshold} days).`,
        actualValue: `${emp.daysSinceUpdated} days`,
        thresholdValue: `> ${settings.staleDaysThreshold} days`,
      });
    }

    // 9. Early-tenure risk (tenure < 6 months with any Warning/Critical signal)
    const hasWarningBeforeEarly = signals.some(
      (s) => s.severity === 'Warning' || s.severity === 'Critical'
    );
    if (emp.tenureMonths < settings.earlyTenureMonths && hasWarningBeforeEarly) {
      signals.push({
        code: 'early_tenure_risk',
        label: 'Early-tenure risk',
        severity: 'Warning',
        reason: `Tenure is ${emp.tenureMonths.toFixed(1)} months (under ${settings.earlyTenureMonths}m) alongside active warning signals.`,
        actualValue: `${emp.tenureMonths.toFixed(1)} months`,
        thresholdValue: `< ${settings.earlyTenureMonths} months`,
      });
    }

    const hasWarningOrCriticalSignal = signals.some(
      (s) => s.severity === 'Warning' || s.severity === 'Critical'
    );
    const missedByCurrentProcess =
      hasWarningOrCriticalSignal && emp.attentionStatus === 'OK';
    const flaggedWithoutSignal =
      !hasWarningOrCriticalSignal && emp.attentionStatus === 'Needs Attention';

    const scores = computeCompositeScores(
      {
        engagementPct: emp.engagementPct,
        workloadLevel: emp.workloadLevel,
        openTasksPercentile,
        overdueShare: emp.overdueShare,
        completionRate: emp.completionRate,
        tenureMonths: emp.tenureMonths,
      },
      settings
    );

    // Local drivers relative to peer median (or company median when small sample)
    const peerEngMed = hasEnoughPeers ? peers.engagementMedian : companyEngagementMedian;
    const peerOpenMed = hasEnoughPeers ? peers.openTasksMedian : companyOpenMedian;
    const peerOverdueMed = hasEnoughPeers ? peers.overdueShareMedian : companyOverdueMedian;
    const peerCompMed = hasEnoughPeers ? peers.completionRateMedian : companyCompletionMedian;

    const wTotal =
      settings.riskWeights.engagement +
        settings.riskWeights.workload +
        settings.riskWeights.delivery +
        settings.riskWeights.tenure || 100;

    const engEffect = Math.round(
      ((peerEngMed - emp.engagementPct) * settings.riskWeights.engagement) / wTotal
    );
    const loadEffect = Math.round(
      (((overduePct - peerOverdueMed) * 0.6 + (emp.openTasks - peerOpenMed) * 2) *
        settings.riskWeights.workload) /
        wTotal
    );
    const compPct = (emp.completionRate ?? 1) * 100;
    const delivEffect = Math.round(
      ((peerCompMed - compPct) * settings.riskWeights.delivery) / wTotal
    );
    const tenEffect = Math.round(
      ((scores.tenureRisk - 25) * settings.riskWeights.tenure) / wTotal
    );

    const candidateDrivers: RiskDriver[] = [
      {
        factor: 'Engagement score',
        employeeValue: `${emp.engagementPct.toFixed(0)}%`,
        peerMedian: `${peerEngMed.toFixed(0)}%`,
        effectPoints: engEffect,
        direction: engEffect >= 0 ? 'up' : 'down',
      },
      {
        factor: 'Overdue task share',
        employeeValue: `${overduePct.toFixed(0)}%`,
        peerMedian: `${peerOverdueMed.toFixed(0)}%`,
        effectPoints: Math.round(((overduePct - peerOverdueMed) * 0.5 * settings.riskWeights.workload) / wTotal),
        direction: overduePct >= peerOverdueMed ? 'up' : 'down',
      },
      {
        factor: 'Open tasks volume',
        employeeValue: `${emp.openTasks} tasks`,
        peerMedian: `${peerOpenMed.toFixed(0)} tasks`,
        effectPoints: loadEffect - Math.round(((overduePct - peerOverdueMed) * 0.5 * settings.riskWeights.workload) / wTotal),
        direction: emp.openTasks >= peerOpenMed ? 'up' : 'down',
      },
      {
        factor: 'Task completion rate',
        employeeValue: `${compPct.toFixed(0)}%`,
        peerMedian: `${peerCompMed.toFixed(0)}%`,
        effectPoints: delivEffect,
        direction: delivEffect >= 0 ? 'up' : 'down',
      },
      {
        factor: 'Tenure band risk',
        employeeValue: `${emp.tenureMonths.toFixed(0)} months`,
        peerMedian: '18 months',
        effectPoints: tenEffect,
        direction: tenEffect >= 0 ? 'up' : 'down',
      },
    ];

    const drivers = candidateDrivers.sort(
      (a, b) => Math.abs(b.effectPoints) - Math.abs(a.effectPoints)
    );

    const prevScore = prevScoreMap.get(emp.employeeId);
    const riskDelta = prevScore !== undefined ? scores.riskScore - prevScore : null;

    return {
      ...emp,
      signals,
      hasWarningOrCriticalSignal,
      missedByCurrentProcess,
      flaggedWithoutSignal,
      ...scores,
      riskDelta,
      drivers,
    };
  });

  // Assign company & department ranks
  const byCompany = [...enriched].sort((a, b) => b.riskScore - a.riskScore);
  const companyRankMap = new Map<string, number>();
  byCompany.forEach((e, idx) => companyRankMap.set(e.employeeId, idx + 1));

  const deptGroups = new Map<string, EmployeeRecord[]>();
  for (const e of enriched) {
    const arr = deptGroups.get(e.department) ?? [];
    arr.push(e);
    deptGroups.set(e.department, arr);
  }
  const deptRankMap = new Map<string, number>();
  for (const list of deptGroups.values()) {
    list.sort((a, b) => b.riskScore - a.riskScore);
    list.forEach((e, idx) => deptRankMap.set(e.employeeId, idx + 1));
  }

  return enriched.map((e) => ({
    ...e,
    riskRankCompany: companyRankMap.get(e.employeeId) ?? 0,
    riskRankDepartment: deptRankMap.get(e.employeeId) ?? 0,
  }));
}

export function whatIfRiskScore(
  emp: EmployeeRecord,
  overrides: {
    engagementPct?: number;
    workloadLevel?: 'Low' | 'Medium' | 'High';
    openTasks?: number;
    overdueTasks?: number;
  },
  allEmployees: EmployeeRecord[],
  settings: WorkforceSettings
): { riskScore: number; riskBand: RiskBand } {
  const newEngPct = overrides.engagementPct ?? emp.engagementPct;
  const newWorkload = overrides.workloadLevel ?? emp.workloadLevel;
  const newOpen = overrides.openTasks ?? emp.openTasks;
  const newOverdue = Math.min(newOpen, overrides.overdueTasks ?? emp.overdueTasks);
  const newOverdueShare = newOpen > 0 ? newOverdue / newOpen : 0;

  const newTotal = Math.max(emp.completedTasks + newOpen, emp.totalTasks);
  const newCompletionRate = newTotal > 0 ? emp.completedTasks / newTotal : 1;

  const peerOpen = allEmployees
    .filter((e) => e.department === emp.department && e.jobLevel === emp.jobLevel)
    .map((e) => e.openTasks)
    .sort((a, b) => a - b);
  const ref = peerOpen.length >= settings.smallSampleThreshold
    ? peerOpen
    : allEmployees.map((e) => e.openTasks).sort((a, b) => a - b);
  const rankBelow = ref.filter((v) => v <= newOpen).length;
  const openTasksPercentile = ref.length > 0 ? Math.round((rankBelow / ref.length) * 100) : 50;

  const res = computeCompositeScores(
    {
      engagementPct: newEngPct,
      workloadLevel: newWorkload,
      openTasksPercentile,
      overdueShare: newOverdueShare,
      completionRate: newCompletionRate,
      tenureMonths: emp.tenureMonths,
    },
    settings
  );
  return { riskScore: res.riskScore, riskBand: res.riskBand };
}

export function hasSignalType(
  emp: EmployeeRecord,
  type: SignalCode | 'missed_warning_signs'
): boolean {
  if (type === 'missed_warning_signs') return emp.missedByCurrentProcess;
  return emp.signals.some((s) => s.code === type);
}
