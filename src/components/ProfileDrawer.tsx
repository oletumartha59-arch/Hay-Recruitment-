import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Sparkles, X, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { formatTenure, formatUkDate } from '../lib/clean/dates';
import { whatIfRiskScore, median } from '../lib/features/signals';
import { maskEmployeeName } from '../lib/metrics';
import type { EmployeeRecord, WorkloadLevel } from '../types/workforce';
import { AttentionChip, RiskBandChip, WorkStatusChip, WorkloadChip } from './StatusChip';

interface ProfileDrawerProps {
  employee: EmployeeRecord | null;
  orderedList: EmployeeRecord[];
  onSelectEmployee: (emp: EmployeeRecord) => void;
  onClose: () => void;
}

export const ProfileDrawer: React.FC<ProfileDrawerProps> = ({
  employee,
  orderedList,
  onSelectEmployee,
  onClose,
}) => {
  const navigate = useNavigate();
  const {
    allEmployees,
    activeSnapshot,
    previousSnapshot,
    settings,
    privacyMode,
    activeModel,
    aiServerAvailable,
  } = useWorkforce();

  const [whatIfEng, setWhatIfEng] = useState(50);
  const [whatIfLoad, setWhatIfLoad] = useState<WorkloadLevel>('Medium');
  const [whatIfOpen, setWhatIfOpen] = useState(5);
  const [whatIfOverdue, setWhatIfOverdue] = useState(0);
  const [aiDriverSummary, setAiDriverSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!employee) return;
    setWhatIfEng(Math.round(employee.engagementPct));
    setWhatIfLoad(employee.workloadLevel);
    setWhatIfOpen(employee.openTasks);
    setWhatIfOverdue(employee.overdueTasks);
    setAiDriverSummary(null);

    if (settings.aiExplanationsEnabled && aiServerAvailable) {
      setAiLoading(true);
      fetch('/api/ai/explain-driver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drivers: employee.drivers.slice(0, 5),
          score: employee.riskScore,
          band: employee.riskBand,
          modelMode: settings.activeRiskMode,
          qualityLabel: activeModel?.qualityLabel ?? 'Rule-weighted Index',
          model: settings.geminiModel,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.summary) setAiDriverSummary(d.summary);
        })
        .catch(() => {})
        .finally(() => setAiLoading(false));
    }
  }, [employee?.employeeId, settings.aiExplanationsEnabled, aiServerAvailable, settings.activeRiskMode, settings.geminiModel, activeModel?.qualityLabel]);

  const peerStats = useMemo(() => {
    if (!employee) return null;
    const peers = allEmployees.filter(
      (e) => e.department === employee.department && e.jobLevel === employee.jobLevel
    );
    const ref = peers.length >= settings.smallSampleThreshold ? peers : allEmployees;
    return {
      peerLabel:
        peers.length >= settings.smallSampleThreshold
          ? `${employee.department} · ${employee.jobLevel} (n=${peers.length})`
          : `Company peers (small group fallback, n=${allEmployees.length})`,
      engMedian: Math.round(median(ref.map((e) => e.engagementPct))),
      openMedian: Math.round(median(ref.map((e) => e.openTasks))),
      overdueMedian: Math.round(median(ref.map((e) => (e.overdueShare ?? 0) * 100))),
    };
  }, [employee, allEmployees, settings.smallSampleThreshold]);

  const whatIfResult = useMemo(() => {
    if (!employee) return null;
    return whatIfRiskScore(
      employee,
      {
        engagementPct: whatIfEng,
        workloadLevel: whatIfLoad,
        openTasks: whatIfOpen,
        overdueTasks: whatIfOverdue,
      },
      allEmployees,
      settings
    );
  }, [employee, whatIfEng, whatIfLoad, whatIfOpen, whatIfOverdue, allEmployees, settings]);

  if (!employee) return null;

  const idx = orderedList.findIndex((e) => e.employeeId === employee.employeeId);
  const prevEmp = idx > 0 ? orderedList[idx - 1] : null;
  const nextEmp = idx >= 0 && idx + 1 < orderedList.length ? orderedList[idx + 1] : null;
  const prevSnapRec = previousSnapshot?.employees.find((e) => e.employeeId === employee.employeeId);

  const scaleMax = activeSnapshot?.engagementScaleMax ?? 10;
  const displayName = maskEmployeeName(employee.employeeName, employee.employeeId, privacyMode);
  const overduePct = employee.overdueShare !== null ? Math.round(employee.overdueShare * 100) : 0;

  const topPositive = employee.drivers.filter((d) => d.effectPoints > 0).slice(0, 5);
  const topNegative = employee.drivers.filter((d) => d.effectPoints < 0).slice(0, 3);

  const totalTasks = Math.max(1, employee.totalTasks);
  const compPctBar = Math.round((employee.completedTasks / totalTasks) * 100);
  const pendPctBar = Math.round((employee.pendingTasks / totalTasks) * 100);
  const overPctBar = Math.max(0, 100 - compPctBar - pendPctBar);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30 no-print" role="dialog" aria-modal="true" aria-label="Employee Profile">
      <div className="w-full max-w-2xl bg-[var(--surface)] h-full overflow-y-auto border-l border-[var(--border)] flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-page-title text-lg font-semibold text-[var(--brown)] truncate">
                {displayName}
              </h2>
              <span className="text-xs font-mono text-[var(--muted)]">{employee.employeeId}</span>
            </div>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {employee.jobLevel} · {employee.department} · {employee.location} · {employee.workArrangement}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!prevEmp}
              onClick={() => prevEmp && onSelectEmployee(prevEmp)}
              aria-label="Previous employee"
              className="w-8 h-8 rounded-lg border border-[var(--border)] inline-flex items-center justify-center disabled:opacity-40 hover:bg-[var(--cream)]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={!nextEmp}
              onClick={() => nextEmp && onSelectEmployee(nextEmp)}
              aria-label="Next employee"
              className="w-8 h-8 rounded-lg border border-[var(--border)] inline-flex items-center justify-center disabled:opacity-40 hover:bg-[var(--cream)]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close profile drawer"
              className="w-8 h-8 rounded-lg border border-[var(--border)] inline-flex items-center justify-center hover:bg-[var(--cream)] ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Status & Metadata */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
            <div className="flex flex-wrap items-center gap-2">
              <WorkStatusChip status={employee.workStatus} />
              <WorkloadChip level={employee.workloadLevel} />
              <AttentionChip status={employee.attentionStatus} />
              {employee.missedByCurrentProcess && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-[var(--oxblood-tint)] text-[var(--risk-critical)] border border-[var(--risk-critical)]/30">
                  <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                  Missed by current process
                </span>
              )}
            </div>
            <div className="text-xs text-[var(--muted)] tabular-nums">
              Hired {formatUkDate(employee.hireDate)} ({formatTenure(employee.tenureMonths)}) · Updated {formatUkDate(employee.lastUpdated)}
              {employee.isStale && <span className="text-[var(--risk-high)] font-semibold"> (Stale)</span>}
            </div>
          </div>

          {/* Risk Score & Model Context */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--cream)]/40 p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs text-[var(--muted)]">
                  Mode: <strong className="text-[var(--brown)]">{settings.activeRiskMode.replace('_', ' ')}</strong> ·{' '}
                  {activeModel ? activeModel.qualityLabel : 'Rule-weighted index'} · Data {formatUkDate(employee.lastUpdated)}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <RiskBandChip band={employee.riskBand} score={employee.riskScore} />
                  <span className="text-xs text-[var(--muted)] tabular-nums">
                    Rank #{employee.riskRankCompany} company · #{employee.riskRankDepartment} {employee.department}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`/recommendations?scopeType=employee&scopeId=${encodeURIComponent(employee.employeeId)}`);
                }}
                className="btn-primary px-3.5 py-2 text-xs inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Generate retention plan
              </button>
            </div>

            {aiLoading ? (
              <p className="text-xs text-[var(--muted)] italic">Generating driver summary...</p>
            ) : (
              <p className="text-xs text-[var(--brown)] leading-relaxed">
                {aiDriverSummary ??
                  `Risk is ${employee.riskBand.toLowerCase()} (${employee.riskScore}/100) primarily driven by ${
                    employee.drivers[0]?.factor.toLowerCase() ?? 'engagement'
                  } (${employee.drivers[0]?.employeeValue ?? ''} vs peer median ${
                    employee.drivers[0]?.peerMedian ?? ''
                  }).`}
              </p>
            )}
          </div>

          {/* KPIs vs Peers */}
          {peerStats && (
            <div>
              <h3 className="text-xs font-semibold text-[var(--brown)] mb-2">
                Metrics vs Peer Median ({peerStats.peerLabel})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-lg border border-[var(--border)] p-2.5 bg-[var(--surface)]">
                  <p className="text-[11px] text-[var(--muted)]">Engagement</p>
                  <p className="text-base font-semibold tabular-nums text-[var(--brown)]">
                    {employee.engagementScore}/{scaleMax} ({Math.round(employee.engagementPct)}%)
                  </p>
                  <p className="text-[11px] text-[var(--muted)] tabular-nums">Peer median {peerStats.engMedian}%</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] p-2.5 bg-[var(--surface)]">
                  <p className="text-[11px] text-[var(--muted)]">Open Tasks</p>
                  <p className="text-base font-semibold tabular-nums text-[var(--brown)]">{employee.openTasks}</p>
                  <p className="text-[11px] text-[var(--muted)] tabular-nums">Peer median {peerStats.openMedian}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] p-2.5 bg-[var(--surface)]">
                  <p className="text-[11px] text-[var(--muted)]">Overdue Share</p>
                  <p className="text-base font-semibold tabular-nums text-[var(--brown)]">{overduePct}%</p>
                  <p className="text-[11px] text-[var(--muted)] tabular-nums">Peer median {peerStats.overdueMedian}%</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] p-2.5 bg-[var(--surface)]">
                  <p className="text-[11px] text-[var(--muted)]">Unused Leave</p>
                  <p className="text-base font-semibold tabular-nums text-[var(--brown)]">{employee.leaveDaysRemaining} days</p>
                  <p className="text-[11px] text-[var(--muted)] tabular-nums">
                    Completion {employee.completionRate !== null ? `${Math.round(employee.completionRate * 100)}%` : 'n/a'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Task Breakdown */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold text-[var(--brown)]">Task Breakdown ({employee.totalTasks} total)</span>
              <span className="text-[var(--muted)] tabular-nums">
                {employee.completedTasks} Completed · {employee.pendingTasks} Pending · {employee.overdueTasks} Overdue
              </span>
            </div>
            <div className="h-3 w-full rounded-full overflow-hidden flex border border-[var(--border)]">
              <div style={{ width: `${compPctBar}%` }} className="bg-[var(--olive)]" title="Completed" />
              <div style={{ width: `${pendPctBar}%` }} className="bg-[var(--amber)]" title="Pending" />
              <div style={{ width: `${overPctBar}%` }} className="bg-[var(--risk-high)]" title="Overdue" />
            </div>
          </div>

          {/* Driver Waterfall */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--brown)] mb-2">
              Risk Driver Waterfall (Factors Raising & Lowering Risk)
            </h3>
            <div className="flex flex-col gap-1.5">
              {topPositive.map((d) => (
                <div key={d.factor} className="flex items-center justify-between gap-2 text-xs px-3 py-1.5 rounded-md bg-[var(--sienna-tint)]/50 border border-[var(--risk-high)]/25">
                  <span className="flex items-center gap-1.5 text-[var(--brown)]">
                    <ArrowUpRight className="w-3.5 h-3.5 text-[var(--risk-high)]" aria-hidden="true" />
                    <strong>{d.factor}</strong>: {d.employeeValue} (peer median {d.peerMedian})
                  </span>
                  <span className="font-semibold text-[var(--risk-high)] tabular-nums">+{d.effectPoints} pts</span>
                </div>
              ))}
              {topNegative.map((d) => (
                <div key={d.factor} className="flex items-center justify-between gap-2 text-xs px-3 py-1.5 rounded-md bg-[var(--olive-tint)]/60 border border-[var(--olive)]/25">
                  <span className="flex items-center gap-1.5 text-[var(--brown)]">
                    <ArrowDownRight className="w-3.5 h-3.5 text-[var(--olive-text)]" aria-hidden="true" />
                    <strong>{d.factor}</strong>: {d.employeeValue} (peer median {d.peerMedian})
                  </span>
                  <span className="font-semibold text-[var(--olive-text)] tabular-nums">{d.effectPoints} pts</span>
                </div>
              ))}
            </div>
          </div>

          {/* Fired Warning Signs */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--brown)] mb-2">
              Computed Warning Signs ({employee.signals.length})
            </h3>
            {employee.signals.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">No warning signals triggered under current thresholds.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {employee.signals.map((sig) => (
                  <div key={sig.code} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs bg-[var(--cream)]/25">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--brown)]">{sig.label}</span>
                      <span className="text-[11px] font-medium text-[var(--risk-high)]">{sig.severity}</span>
                    </div>
                    <p className="text-[var(--muted)] mt-0.5">{sig.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Snapshot history comparison */}
          {prevSnapRec && (
            <div className="rounded-lg border border-[var(--border)] p-3 text-xs bg-[var(--cream)]/30">
              <p className="font-semibold text-[var(--brown)] mb-1">Changes Since Previous Snapshot</p>
              <p className="text-[var(--muted)] tabular-nums">
                Risk Score: {prevSnapRec.riskScore} → {employee.riskScore} · Engagement:{' '}
                {prevSnapRec.engagementScore} → {employee.engagementScore} · Work Status:{' '}
                {prevSnapRec.workStatus} → {employee.workStatus}
              </p>
            </div>
          )}

          {/* Deterministic What-If Simulator */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--cream)]/35 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[var(--brown)]">
                  What-If Retention Score Simulator (Deterministic)
                </h3>
                <p className="text-[11px] text-[var(--muted)]">
                  Adjust engagement, workload, or open tasks to preview Retention Risk Index impact.
                </p>
              </div>
              {whatIfResult && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)] tabular-nums">
                    {employee.riskScore} →
                  </span>
                  <RiskBandChip band={whatIfResult.riskBand} score={whatIfResult.riskScore} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-[var(--brown)] font-medium mb-1">
                  Engagement ({whatIfEng}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={whatIfEng}
                  onChange={(e) => setWhatIfEng(Number(e.target.value))}
                  className="w-full accent-[var(--amber)]"
                />
              </div>
              <div>
                <label className="block text-[var(--brown)] font-medium mb-1">
                  Workload Level
                </label>
                <select
                  value={whatIfLoad}
                  onChange={(e) => setWhatIfLoad(e.target.value as WorkloadLevel)}
                  className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--surface)]"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div>
                <label className="block text-[var(--brown)] font-medium mb-1">
                  Open / Overdue ({whatIfOpen} / {whatIfOverdue})
                </label>
                <input
                  type="range"
                  min={0}
                  max={Math.max(25, employee.openTasks + 5)}
                  value={whatIfOpen}
                  onChange={(e) => {
                    const nextOpen = Number(e.target.value);
                    setWhatIfOpen(nextOpen);
                    if (whatIfOverdue > nextOpen) setWhatIfOverdue(nextOpen);
                  }}
                  className="w-full accent-[var(--amber)]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
