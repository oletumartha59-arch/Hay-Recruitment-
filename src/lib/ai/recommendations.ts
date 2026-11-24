import {
  RecommendationSchema,
  type EmployeeRecord,
  type RetentionPlan,
  type SignalCode,
  type WorkforceSettings,
} from '../../types/workforce';
import { computeCompositeScores, median } from '../features/signals';
import { maskEmployeeName } from '../metrics';

export interface PlaybookAction {
  playbookId: string;
  signal: SignalCode | 'general';
  priority: 'P1' | 'P2' | 'P3';
  title: string;
  practice: string;
  defaultEffort: 'Low' | 'Medium' | 'High';
  steps: Array<{ order: number; action: string; owner: string; dueInDays: number }>;
  risks: string[];
  conversationPrompts: string[];
}

export const HR_PLAYBOOKS: PlaybookAction[] = [
  {
    playbookId: 'pb_burnout',
    signal: 'burnout_pattern',
    priority: 'P1',
    title: 'Immediate Burnout Prevention & Capacity Reset',
    practice: 'Workload rebalancing and protected recovery scheduling',
    defaultEffort: 'Medium',
    steps: [
      { order: 1, action: 'Hold a supportive 1:1 check-in to review immediate deliverables and stress indicators.', owner: 'Line Manager', dueInDays: 3 },
      { order: 2, action: 'Reassign or pause lower-priority requisitions and tasks for the next 14 days.', owner: 'Line Manager', dueInDays: 5 },
      { order: 3, action: 'Schedule protected leave days if leave balance is above peer median.', owner: 'HR Business Partner', dueInDays: 7 },
    ],
    risks: ['Reassigning tasks without briefing receiving consultants can shift pressure elsewhere in the team.'],
    conversationPrompts: [
      'Which current client requisitions or tasks feel unsustainable right now?',
      'What two deliverables would make the biggest difference if we reprioritised or handed them over this week?',
    ],
  },
  {
    playbookId: 'pb_overload',
    signal: 'severe_overload',
    priority: 'P1',
    title: 'Urgent Deadline Renegotiation & Task Triage',
    practice: 'Structured workload triage and SLA recalibration',
    defaultEffort: 'Medium',
    steps: [
      { order: 1, action: 'Audit all overdue tasks and separate client-critical items from internal admin.', owner: 'Line Manager', dueInDays: 2 },
      { order: 2, action: 'Renegotiate realistic due dates or pair with a peer consultant on backlogged pipelines.', owner: 'Team Lead', dueInDays: 5 },
      { order: 3, action: 'Review task allocation rules at the next weekly team capacity huddle.', owner: 'Operations Lead', dueInDays: 14 },
    ],
    risks: ['Extending deadlines without client communication can erode client trust.'],
    conversationPrompts: [
      'Where are bottlenecks occurring in your current overdue queue?',
      'Do you have the admin or resourcer support needed for high-volume desks?',
    ],
  },
  {
    playbookId: 'pb_heavy_workload',
    signal: 'heavy_workload',
    priority: 'P2',
    title: 'Workload Rebalancing Across Desk Peers',
    practice: 'Peer capacity levelling',
    defaultEffort: 'Medium',
    steps: [
      { order: 1, action: 'Compare open task load against department and job-level peers.', owner: 'Line Manager', dueInDays: 7 },
      { order: 2, action: 'Cap new inbound req assignments until open tasks drop below peer 75th percentile.', owner: 'Team Lead', dueInDays: 14 },
    ],
    risks: ['Short-term commission or placement targets may need temporary adjustment alongside load caps.'],
    conversationPrompts: [
      'Are new reqs being distributed evenly across your level?',
    ],
  },
  {
    playbookId: 'pb_engagement_crit',
    signal: 'critical_engagement',
    priority: 'P1',
    title: 'Stay Interview & Role Alignment Intervention',
    practice: 'Structured stay conversation and career pathing',
    defaultEffort: 'Low',
    steps: [
      { order: 1, action: 'Conduct a confidential stay interview focused on motivators, manager support, and role fit.', owner: 'HR Business Partner', dueInDays: 5 },
      { order: 2, action: 'Agree 2 concrete adjustments (desk focus, hybrid flexibility, or L&D progression) within 21 days.', owner: 'Line Manager', dueInDays: 14 },
      { order: 3, action: 'Check pulse sentiment again at the 30-day mark.', owner: 'HR Business Partner', dueInDays: 30 },
    ],
    risks: ['Treating the score as punitive rather than exploratory will reduce psychological safety.'],
    conversationPrompts: [
      'What part of your role gives you the most energy, and what has been draining it recently?',
      'What would make the next 90 days at Hay Recruitment feel genuinely rewarding?',
    ],
  },
  {
    playbookId: 'pb_engagement_low',
    signal: 'low_engagement',
    priority: 'P2',
    title: 'Recognition, Career Pathing & Feedback Reset',
    practice: 'Career development planning and structured recognition',
    defaultEffort: 'Low',
    steps: [
      { order: 1, action: 'Review recent achievements and ensure transparent recognition in team forums.', owner: 'Line Manager', dueInDays: 7 },
      { order: 2, action: 'Create a 90-day progression milestone plan aligned to the next Job Level.', owner: 'Line Manager', dueInDays: 21 },
    ],
    risks: ['Promising progression without clear measurable criteria leads to further disengagement.'],
    conversationPrompts: [
      'Are expectations for progression to the next level clear and achievable?',
    ],
  },
  {
    playbookId: 'pb_unused_leave',
    signal: 'unused_leave',
    priority: 'P2',
    title: 'Planned Annual Leave & Recovery Booking',
    practice: 'Proactive annual leave scheduling',
    defaultEffort: 'Low',
    steps: [
      { order: 1, action: 'Encourage and approve at least 3 to 5 consecutive days of leave within the next 45 days.', owner: 'Line Manager', dueInDays: 14 },
      { order: 2, action: 'Assign desk cover buddy before leave so urgent placements continue smoothly.', owner: 'Team Lead', dueInDays: 21 },
    ],
    risks: ['Without arranged desk cover, consultants often check emails during leave and fail to recover.'],
    conversationPrompts: [
      'What has prevented you from booking your remaining leave days this quarter?',
    ],
  },
  {
    playbookId: 'pb_early_tenure',
    signal: 'early_tenure_risk',
    priority: 'P1',
    title: 'Structured Onboarding & Buddy Check-In',
    practice: '90-day onboarding reinforcement',
    defaultEffort: 'Low',
    steps: [
      { order: 1, action: 'Run a 30-minute onboarding friction review covering tools, training, and manager cadence.', owner: 'HR Business Partner', dueInDays: 5 },
      { order: 2, action: 'Pair with a Senior Consultant peer buddy for weekly shadowing.', owner: 'Line Manager', dueInDays: 10 },
    ],
    risks: ['Early-tenure consultants may hesitate to ask questions without scheduled safe check-ins.'],
    conversationPrompts: [
      'Which parts of our recruitment workflow still feel unclear or under-supported?',
    ],
  },
  {
    playbookId: 'pb_delivery',
    signal: 'delivery_slippage',
    priority: 'P2',
    title: 'Pipeline Coaching & Task Prioritisation',
    practice: 'Weekly sprint coaching',
    defaultEffort: 'Medium',
    steps: [
      { order: 1, action: 'Break large stalled tasks into smaller daily milestones in weekly 1:1s.', owner: 'Line Manager', dueInDays: 7 },
      { order: 2, action: 'Identify tooling or training blockers slowing task completion.', owner: 'Team Lead', dueInDays: 14 },
    ],
    risks: ['Micromanagement perception if framed around policing rather than removing blockers.'],
    conversationPrompts: [
      'Where do tasks most often stall between candidate sourcing and client submission?',
    ],
  },
  {
    playbookId: 'pb_stale',
    signal: 'stale_record',
    priority: 'P3',
    title: 'Workforce Record Refresh & Data Hygiene',
    practice: 'HRIS / tracker synchronisation',
    defaultEffort: 'Low',
    steps: [
      { order: 1, action: 'Confirm current engagement, task counts, and attendance status with the line manager.', owner: 'HR Analyst', dueInDays: 14 },
    ],
    risks: ['Acting on stale metrics can lead to misplaced interventions.'],
    conversationPrompts: [],
  },
];

export interface EvidencePack {
  scope: { type: 'employee' | 'team' | 'company'; id: string; label: string };
  employeeCount: number;
  modelMode: string;
  qualityLabel: string;
  avgRiskScore: number;
  riskBand: string;
  metrics: Record<string, string | number>;
  peerMedians: Record<string, string | number>;
  firedSignals: Array<{ code: string; label: string; severity: string; count: number; detail: string }>;
  topDrivers: Array<{ factor: string; employeeValue: string; peerMedian: string; effectPoints: number }>;
  topTeamsByRisk?: Array<{ team: string; avgRisk: number; count: number; highCriticalCount: number }>;
  attentionTags: string[];
  dataFreshnessNote: string;
}

export function buildEvidencePack(
  scopeType: 'employee' | 'team' | 'company',
  scopeId: string,
  allEmployees: EmployeeRecord[],
  settings: WorkforceSettings,
  privacyMode: boolean,
  includeNamesInAI: boolean
): {
  evidencePack: EvidencePack;
  candidateActions: PlaybookAction[];
  targetEmployees: EmployeeRecord[];
} {
  const mask = privacyMode || !includeNamesInAI;

  if (scopeType === 'employee') {
    const emp = allEmployees.find((e) => e.employeeId === scopeId) ?? allEmployees[0];
    const peers = allEmployees.filter(
      (e) => e.department === emp.department && e.jobLevel === emp.jobLevel
    );
    const refPeers = peers.length >= settings.smallSampleThreshold ? peers : allEmployees;

    const peerEng = Math.round(median(refPeers.map((e) => e.engagementPct)));
    const peerOpen = Math.round(median(refPeers.map((e) => e.openTasks)));
    const peerOverdue = Math.round(median(refPeers.map((e) => (e.overdueShare ?? 0) * 100)));
    const peerLeave = Math.round(median(refPeers.map((e) => e.leaveDaysRemaining)));
    const overduePct = Math.round((emp.overdueShare ?? 0) * 100);
    const compPct = Math.round((emp.completionRate ?? 1) * 100);

    const signalCodes = new Set(emp.signals.map((s) => s.code));
    const candidateActions = HR_PLAYBOOKS.filter((pb) =>
      pb.signal === 'general' ? false : signalCodes.has(pb.signal)
    );
    if (candidateActions.length === 0) {
      candidateActions.push(HR_PLAYBOOKS.find((p) => p.playbookId === 'pb_engagement_low')!);
    }

    return {
      targetEmployees: [emp],
      candidateActions,
      evidencePack: {
        scope: {
          type: 'employee',
          id: emp.employeeId,
          label: maskEmployeeName(emp.employeeName, emp.employeeId, mask),
        },
        employeeCount: 1,
        modelMode: settings.activeRiskMode,
        qualityLabel: settings.activeRiskMode === 'retention_index' ? 'Rule-weighted index' : 'Trained model',
        avgRiskScore: emp.riskScore,
        riskBand: emp.riskBand,
        metrics: {
          department: emp.department,
          jobLevel: emp.jobLevel,
          location: emp.location,
          workStatus: emp.workStatus,
          engagementPct: Math.round(emp.engagementPct),
          openTasks: emp.openTasks,
          overdueTasks: emp.overdueTasks,
          overdueSharePct: overduePct,
          completionRatePct: compPct,
          workloadLevel: emp.workloadLevel,
          leaveDaysRemaining: emp.leaveDaysRemaining,
          tenureMonths: Math.round(emp.tenureMonths),
          attentionStatus: emp.attentionStatus,
          missedByCurrentProcess: emp.missedByCurrentProcess ? 'Yes' : 'No',
        },
        peerMedians: {
          peerGroupSize: refPeers.length,
          engagementPct: peerEng,
          openTasks: peerOpen,
          overdueSharePct: peerOverdue,
          leaveDaysRemaining: peerLeave,
        },
        firedSignals: emp.signals.map((s) => ({
          code: s.code,
          label: s.label,
          severity: s.severity,
          count: 1,
          detail: s.reason,
        })),
        topDrivers: emp.drivers.slice(0, 5),
        attentionTags: emp.attentionReasonTags,
        dataFreshnessNote: emp.isStale ? `Stale (${emp.daysSinceUpdated} days old)` : `Updated ${emp.daysSinceUpdated} days ago`,
      },
    };
  }

  // Team or Company scope
  const targetEmployees =
    scopeType === 'team'
      ? allEmployees.filter((e) => e.department === scopeId || e.location === scopeId)
      : allEmployees;
  const list = targetEmployees.length > 0 ? targetEmployees : allEmployees;

  const avgEng = Math.round(list.reduce((a, b) => a + b.engagementPct, 0) / list.length);
  const avgRisk = Math.round(list.reduce((a, b) => a + b.riskScore, 0) / list.length);
  const avgOverdueShare = Math.round(
    (list.reduce((a, b) => a + (b.overdueShare ?? 0), 0) / list.length) * 100
  );
  const missedCount = list.filter((e) => e.missedByCurrentProcess).length;
  const highCritCount = list.filter((e) => e.riskBand === 'High' || e.riskBand === 'Critical').length;

  const signalCounts = new Map<SignalCode, { label: string; severity: string; count: number }>();
  for (const e of list) {
    for (const s of e.signals) {
      const cur = signalCounts.get(s.code);
      if (cur) cur.count += 1;
      else signalCounts.set(s.code, { label: s.label, severity: s.severity, count: 1 });
    }
  }
  const firedSignals = Array.from(signalCounts.entries())
    .map(([code, v]) => ({
      code,
      label: v.label,
      severity: v.severity,
      count: v.count,
      detail: `${v.count} of ${list.length} employees (${Math.round((v.count / list.length) * 100)}%) triggered ${v.label}.`,
    }))
    .sort((a, b) => b.count - a.count);

  // Top 5 teams by risk
  const deptBuckets = new Map<string, EmployeeRecord[]>();
  for (const e of list) {
    const arr = deptBuckets.get(e.department) ?? [];
    arr.push(e);
    deptBuckets.set(e.department, arr);
  }
  const topTeamsByRisk = Array.from(deptBuckets.entries())
    .map(([team, emps]) => ({
      team,
      avgRisk: Math.round(emps.reduce((a, b) => a + b.riskScore, 0) / emps.length),
      count: emps.length,
      highCriticalCount: emps.filter((x) => x.riskBand === 'High' || x.riskBand === 'Critical').length,
    }))
    .sort((a, b) => b.avgRisk - a.avgRisk)
    .slice(0, 5);

  const topCodes = new Set(firedSignals.slice(0, 4).map((s) => s.code));
  const candidateActions = HR_PLAYBOOKS.filter((pb) => topCodes.has(pb.signal as SignalCode));
  if (candidateActions.length === 0) candidateActions.push(HR_PLAYBOOKS[0], HR_PLAYBOOKS[3]);

  const companyAvgEng = Math.round(
    allEmployees.reduce((a, b) => a + b.engagementPct, 0) / Math.max(1, allEmployees.length)
  );
  const companyAvgOverdue = Math.round(
    (allEmployees.reduce((a, b) => a + (b.overdueShare ?? 0), 0) / Math.max(1, allEmployees.length)) * 100
  );

  return {
    targetEmployees: list,
    candidateActions,
    evidencePack: {
      scope: { type: scopeType, id: scopeId, label: scopeType === 'company' ? 'Hay Recruitment (Company-wide)' : scopeId },
      employeeCount: list.length,
      modelMode: settings.activeRiskMode,
      qualityLabel: settings.activeRiskMode === 'retention_index' ? 'Rule-weighted index' : 'Trained model',
      avgRiskScore: avgRisk,
      riskBand: avgRisk >= 75 ? 'Critical' : avgRisk >= 55 ? 'High' : avgRisk >= 30 ? 'Medium' : 'Low',
      metrics: {
        employeesAffected: list.length,
        highAndCriticalCount: highCritCount,
        missedWarningSigns: missedCount,
        avgEngagementPct: avgEng,
        avgOverdueSharePct: avgOverdueShare,
        staleRecords: list.filter((e) => e.isStale).length,
      },
      peerMedians: {
        companyAvgEngagementPct: companyAvgEng,
        companyAvgOverdueSharePct: companyAvgOverdue,
      },
      firedSignals,
      topDrivers: [
        { factor: 'Engagement score', employeeValue: `${avgEng}%`, peerMedian: `${companyAvgEng}%`, effectPoints: Math.round((companyAvgEng - avgEng) * 0.4) },
        { factor: 'Overdue task share', employeeValue: `${avgOverdueShare}%`, peerMedian: `${companyAvgOverdue}%`, effectPoints: Math.round((avgOverdueShare - companyAvgOverdue) * 0.3) },
      ],
      topTeamsByRisk,
      attentionTags: [],
      dataFreshnessNote: `${list.filter((e) => e.isStale).length} records over ${settings.staleDaysThreshold} days old`,
    },
  };
}

/**
 * Deterministic impact simulation: moves targeted drivers toward peer median and recomputes Retention Risk Index.
 */
export function simulateImpactScore(
  targetEmployees: EmployeeRecord[],
  settings: WorkforceSettings
): { riskScoreBefore: number; riskScoreAfter: number } {
  if (targetEmployees.length === 0) return { riskScoreBefore: 0, riskScoreAfter: 0 };
  const before = Math.round(
    targetEmployees.reduce((a, b) => a + b.riskScore, 0) / targetEmployees.length
  );

  const afterScores = targetEmployees.map((emp) => {
    const improvedEng = Math.min(100, Math.max(emp.engagementPct, 65));
    const improvedOverdueShare = Math.min(emp.overdueShare ?? 0, 0.2);
    const improvedLoad = emp.workloadLevel === 'High' ? 'Medium' : emp.workloadLevel;
    const improvedCompletion = Math.max(emp.completionRate ?? 1, 0.78);
    const res = computeCompositeScores(
      {
        engagementPct: improvedEng,
        workloadLevel: improvedLoad,
        openTasksPercentile: 45,
        overdueShare: improvedOverdueShare,
        completionRate: improvedCompletion,
        tenureMonths: emp.tenureMonths,
      },
      settings
    );
    return res.riskScore;
  });

  const after = Math.round(afterScores.reduce((a, b) => a + b, 0) / afterScores.length);
  return { riskScoreBefore: before, riskScoreAfter: Math.min(before, after) };
}

function addDaysIso(days: number): string {
  const dt = new Date(Date.now() + days * 86400000);
  return dt.toISOString().slice(0, 10);
}

/**
 * Deterministic HR playbook fallback matching the exact RetentionPlan Zod schema.
 */
export function buildPlaybookFallbackPlan(
  evidencePack: EvidencePack,
  candidateActions: PlaybookAction[],
  targetEmployees: EmployeeRecord[],
  settings: WorkforceSettings
): RetentionPlan {
  const impact = simulateImpactScore(targetEmployees, settings);
  const topDriver = evidencePack.topDrivers[0];

  // Enforce max 3 P1 actions
  let p1Count = 0;
  const recommendations = candidateActions.slice(0, 4).map((pb, idx) => {
    let priority = pb.priority;
    if (priority === 'P1') {
      p1Count += 1;
      if (p1Count > 3) priority = 'P2';
    }
    const signalMatch = evidencePack.firedSignals.find((s) => s.code === pb.signal);
    const evidenceItem = signalMatch
      ? {
          metric: signalMatch.label,
          value: signalMatch.detail,
          comparison: `Scope: ${evidencePack.employeeCount} employee(s)`,
        }
      : {
          metric: topDriver?.factor ?? 'Engagement score',
          value: topDriver?.employeeValue ?? `${evidencePack.metrics.avgEngagementPct}%`,
          comparison: `Peer median ${topDriver?.peerMedian ?? evidencePack.peerMedians.engagementPct ?? 'n/a'}%`,
        };

    return {
      id: `${pb.playbookId}_${idx + 1}`,
      priority,
      title: pb.title,
      rationale: `${pb.practice} is recommended because ${evidenceItem.metric} shows ${evidenceItem.value} (${evidenceItem.comparison}).`,
      evidence: [evidenceItem],
      steps: pb.steps,
      effort: pb.defaultEffort,
      expectedImpact: {
        riskScoreBefore: impact.riskScoreBefore,
        riskScoreAfter: impact.riskScoreAfter,
        confidence: evidencePack.employeeCount >= 10 ? ('Medium' as const) : ('Low' as const),
      },
      kpis: [
        {
          name: pb.signal.includes('engagement')
            ? 'Engagement score (% of scale)'
            : pb.signal.includes('leave')
            ? 'Unused leave days remaining'
            : 'Overdue task share (%)',
          baseline: String(
            pb.signal.includes('engagement')
              ? `${evidencePack.metrics.engagementPct ?? evidencePack.metrics.avgEngagementPct}%`
              : pb.signal.includes('leave')
              ? `${evidencePack.metrics.leaveDaysRemaining ?? 'Above P75'} days`
              : `${evidencePack.metrics.overdueSharePct ?? evidencePack.metrics.avgOverdueSharePct}%`
          ),
          target: pb.signal.includes('engagement')
            ? 'Above 65% of scale'
            : pb.signal.includes('leave')
            ? 'At or below peer median'
            : 'Under 25% overdue',
          measureBy: 'Next workforce data upload & manager check-in',
          reviewDate: addDaysIso(priority === 'P1' ? 30 : 60),
        },
      ],
      risks: pb.risks,
      conversationGuide: evidencePack.scope.type === 'employee' ? pb.conversationPrompts : undefined,
    };
  });

  const plan: RetentionPlan = {
    scope: {
      type: evidencePack.scope.type,
      id: evidencePack.scope.id,
    },
    summary: `${evidencePack.scope.label} sits at a retention risk score of ${evidencePack.avgRiskScore} (${evidencePack.riskBand} band). Primary signals: ${
      evidencePack.firedSignals.slice(0, 2).map((s) => s.label).join(' and ') || 'engagement and workload review'
    }. Simulated risk score after targeted interventions: ${impact.riskScoreBefore} to ${impact.riskScoreAfter} (a simulation, not a guarantee).`,
    riskContext: {
      score: evidencePack.avgRiskScore,
      band: evidencePack.riskBand,
      topDrivers: evidencePack.topDrivers.slice(0, 5),
    },
    recommendations,
    monitoringPlan: {
      reviewCadence: 'Review P1 actions in 7 days, P2 progress at 30 days, and full KPI shift at 60 days.',
      escalationTrigger: 'Escalate to HR Director if risk score remains in High/Critical after 30 days or overdue share exceeds 50%.',
    },
    limitations: [
      'Decision support, requires human review before any management action.',
      `Generated under ${evidencePack.modelMode} mode; impact score (${impact.riskScoreBefore} -> ${impact.riskScoreAfter}) is a deterministic simulation, not a guarantee.`,
      evidencePack.dataFreshnessNote,
    ],
  };

  return RecommendationSchema.parse(plan);
}

export function validateAiRecommendationNumbers(
  aiJson: unknown,
  evidencePack: EvidencePack
): { ok: boolean; reason?: string; parsed?: RetentionPlan } {
  if (!aiJson || typeof aiJson !== 'object') {
    return { ok: false, reason: 'Output was not a JSON object.' };
  }
  const obj = aiJson as Record<string, unknown>;
  const recs = Array.isArray(obj.recommendations) ? obj.recommendations : [];
  if (recs.length === 0) {
    return { ok: false, reason: 'Recommendations array was empty.' };
  }

  // Enforce max 3 P1 actions
  const p1s = recs.filter((r) => (r as { priority?: string }).priority === 'P1');
  if (p1s.length > 3) {
    return { ok: false, reason: 'Exceeded maximum of 3 P1 recommendations.' };
  }

  const evidenceStr = JSON.stringify(evidencePack);
  // Check cited metric values in evidence blocks exist in evidencePack
  for (const r of recs) {
    const rec = r as { evidence?: Array<{ value?: string }> };
    for (const ev of rec.evidence ?? []) {
      const nums = String(ev.value ?? '').match(/\b\d+(?:\.\d+)?\b/g) ?? [];
      for (const n of nums) {
        if (!evidenceStr.includes(n)) {
          return {
            ok: false,
            reason: `Cited evidence number "${n}" does not match any figure in evidencePack.`,
          };
        }
      }
    }
  }

  return { ok: true };
}
