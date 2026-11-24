import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Sparkles, CheckSquare, ShieldAlert } from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import {
  buildEvidencePack,
  buildPlaybookFallbackPlan,
  validateAiRecommendationNumbers,
} from '../lib/ai/recommendations';
import { maskEmployeeName } from '../lib/metrics';
import { exportRetentionPlanPdf } from '../lib/reports/exports';
import {
  RecommendationSchema,
  type RetentionPlan,
  type SavedRecommendationRecord,
} from '../types/workforce';

export const RecommendationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    allEmployees,
    activeSnapshot,
    previousSnapshot,
    settings,
    privacyMode,
    recommendations,
    saveRecommendation,
    aiServerAvailable,
    pushToast,
  } = useWorkforce();

  const initialType = (searchParams.get('scopeType') as 'employee' | 'team' | 'company') || 'company';
  const initialId = searchParams.get('scopeId') || 'company';

  const [scopeType, setScopeType] = useState<'employee' | 'team' | 'company'>(initialType);
  const [scopeId, setScopeId] = useState<string>(initialId);
  const [planOnPage, setPlanOnPage] = useState(false);
  const [generating, setGenerating] = useState(false);

  const departments = useMemo(
    () => Array.from(new Set(allEmployees.map((e) => e.department))).sort(),
    [allEmployees]
  );

  const highRiskEmployees = useMemo(
    () => [...allEmployees].sort((a, b) => b.riskScore - a.riskScore).slice(0, 60),
    [allEmployees]
  );

  useEffect(() => {
    if (scopeType === 'company') setScopeId('company');
    else if (scopeType === 'team' && !departments.includes(scopeId)) {
      setScopeId(departments[0] ?? '');
    } else if (
      scopeType === 'employee' &&
      !allEmployees.some((e) => e.employeeId === scopeId)
    ) {
      setScopeId(highRiskEmployees[0]?.employeeId ?? '');
    }
  }, [scopeType, departments, allEmployees, highRiskEmployees, scopeId]);

  const scopeKey = `${scopeType}:${scopeId}`;
  const currentSaved = useMemo(
    () =>
      recommendations.find(
        (r) => r.scopeKey === scopeKey && r.snapshotId === activeSnapshot?.id
      ) ?? recommendations.find((r) => r.scopeKey === scopeKey),
    [recommendations, scopeKey, activeSnapshot?.id]
  );

  const evidenceBundle = useMemo(() => {
    if (allEmployees.length === 0 || !scopeId) return null;
    return buildEvidencePack(
      scopeType,
      scopeId,
      allEmployees,
      settings,
      privacyMode,
      settings.includeNamesInAI
    );
  }, [allEmployees, scopeType, scopeId, settings, privacyMode]);

  const handleGenerate = async () => {
    if (!evidenceBundle || !activeSnapshot) return;
    setGenerating(true);

    const fallbackPlan = buildPlaybookFallbackPlan(
      evidenceBundle.evidencePack,
      evidenceBundle.candidateActions,
      evidenceBundle.targetEmployees,
      settings
    );

    let finalPlan: RetentionPlan = fallbackPlan;
    let source: SavedRecommendationRecord['source'] = 'playbook_fallback';

    if (aiServerAvailable && settings.aiExplanationsEnabled) {
      const attempt = async (retryReason = ''): Promise<RetentionPlan | null> => {
        const res = await fetch('/api/ai/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            evidencePack: evidenceBundle.evidencePack,
            candidateActions: evidenceBundle.candidateActions,
            retryReason,
            model: settings.geminiModel,
          }),
        });
        if (!res.ok) return null;
        const { jsonText } = await res.json();
        const raw = JSON.parse(jsonText);
        // Merge deterministic scope, riskContext, and expectedImpact so Gemini never invents impact numbers
        const merged = {
          ...fallbackPlan,
          ...raw,
          scope: fallbackPlan.scope,
          riskContext: fallbackPlan.riskContext,
          recommendations: Array.isArray(raw.recommendations)
            ? raw.recommendations.map((r: Record<string, unknown>, idx: number) => ({
                ...r,
                expectedImpact:
                  fallbackPlan.recommendations[idx]?.expectedImpact ??
                  fallbackPlan.recommendations[0].expectedImpact,
              }))
            : fallbackPlan.recommendations,
        };
        const zodRes = RecommendationSchema.safeParse(merged);
        if (!zodRes.success) return null;
        const numCheck = validateAiRecommendationNumbers(zodRes.data, evidenceBundle.evidencePack);
        if (!numCheck.ok) return null;
        return zodRes.data;
      };

      try {
        let aiPlan = await attempt();
        if (!aiPlan) {
          aiPlan = await attempt('Ensure strict schema compliance and cite ONLY numbers present in evidencePack.');
        }
        if (aiPlan) {
          finalPlan = aiPlan;
          source = 'gemini';
        }
      } catch {
        // Use playbook fallback
      }
    }

    const actionStatuses: SavedRecommendationRecord['actionStatuses'] = {};
    finalPlan.recommendations.forEach((r) => {
      actionStatuses[r.id] = { status: 'Not started' };
    });

    const record: SavedRecommendationRecord = {
      id: `rec_${Date.now()}`,
      scopeKey,
      createdAt: new Date().toISOString(),
      snapshotId: activeSnapshot.id,
      source,
      plan: finalPlan,
      actionStatuses,
    };

    await saveRecommendation(record);
    setGenerating(false);
    pushToast(
      source === 'gemini'
        ? 'Generated evidence-based retention plan.'
        : 'Generated retention plan from HR playbooks.',
      'success'
    );
  };

  const updateActionStatus = async (
    actionId: string,
    patch: Partial<SavedRecommendationRecord['actionStatuses'][string]>
  ) => {
    if (!currentSaved) return;
    const updated: SavedRecommendationRecord = {
      ...currentSaved,
      actionStatuses: {
        ...currentSaved.actionStatuses,
        [actionId]: {
          ...currentSaved.actionStatuses[actionId],
          ...patch,
        },
      },
    };
    await saveRecommendation(updated);
  };

  if (allEmployees.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center card-surface mt-8">
        <h1 className="font-page-title text-xl font-semibold text-[var(--brown)]">
          Retention Recommendations Engine
        </h1>
        <p className="text-xs text-[var(--muted)] mt-2 mb-4">
          Upload workforce data or load demo data first to generate personalised retention plans.
        </p>
        <button type="button" onClick={() => navigate('/')} className="btn-primary px-4 py-2 text-xs">
          Go to Home
        </button>
      </div>
    );
  }

  const plan = currentSaved?.plan ?? null;

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5 max-w-[1400px] w-full mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-page-title text-2xl font-semibold text-[var(--brown)]">
            Retention Recommendations
          </h1>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Evidence-based, prioritised retention interventions · Decision support, requires human review
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={() => setPlanOnPage((v) => !v)}
            className="btn-secondary px-3 py-2 text-xs"
          >
            {planOnPage ? 'Detailed card view' : 'Plan on a page'}
          </button>
          {plan && activeSnapshot && (
            <button
              type="button"
              onClick={() =>
                exportRetentionPlanPdf({
                  plan,
                  privacyMode,
                  sourceFile: activeSnapshot.fileName,
                  uploadDate: activeSnapshot.uploadedAt.slice(0, 10),
                })
              }
              className="btn-secondary px-3 py-2 text-xs inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download PDF
            </button>
          )}
        </div>
      </div>

      {/* Fairness & Human Review Banner */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--amber-tint)]/45 px-4 py-3 text-xs text-[var(--brown)] flex items-start gap-2.5">
        <ShieldAlert className="w-4 h-4 text-[var(--ink-on-amber)] shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          <strong>Decision support, requires human review.</strong> Base decisions on the underlying evidence, hold a direct supportive conversation with the employee, and never act on a risk score alone.
        </span>
      </div>

      {/* Scope Picker */}
      <section className="card-surface p-4 flex flex-wrap items-end justify-between gap-4 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-[var(--brown)] mb-1">
              Scope
            </label>
            <select
              value={scopeType}
              onChange={(e) => setScopeType(e.target.value as 'employee' | 'team' | 'company')}
              className="h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs"
            >
              <option value="company">Company-wide</option>
              <option value="team">Team / Department</option>
              <option value="employee">Individual Employee</option>
            </select>
          </div>

          {scopeType === 'team' && (
            <div>
              <label className="block text-xs font-semibold text-[var(--brown)] mb-1">
                Department
              </label>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs"
              >
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}

          {scopeType === 'employee' && (
            <div>
              <label className="block text-xs font-semibold text-[var(--brown)] mb-1">
                Employee (sorted by risk)
              </label>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs min-w-[240px]"
              >
                {highRiskEmployees.map((e) => (
                  <option key={e.employeeId} value={e.employeeId}>
                    {maskEmployeeName(e.employeeName, e.employeeId, privacyMode)} · Risk {e.riskScore} ({e.department})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={generating || !evidenceBundle}
          onClick={handleGenerate}
          className="btn-primary px-4 py-2 text-xs inline-flex items-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          {generating ? 'Building plan...' : plan ? 'Regenerate retention plan' : 'Generate retention plan'}
        </button>
      </section>

      {/* Evidence Summary before/with Plan */}
      {evidenceBundle && !plan && (
        <div className="card-surface p-6 text-center flex flex-col items-center gap-3">
          <p className="text-sm font-semibold text-[var(--brown)]">
            Evidence pack ready for {evidenceBundle.evidencePack.scope.label}
          </p>
          <p className="text-xs text-[var(--muted)] max-w-xl">
            {evidenceBundle.evidencePack.employeeCount} employee(s) · Average Risk Score{' '}
            {evidenceBundle.evidencePack.avgRiskScore} ({evidenceBundle.evidencePack.riskBand}) ·{' '}
            {evidenceBundle.evidencePack.firedSignals.length} active warning signal types.
          </p>
          <button
            type="button"
            disabled={generating}
            onClick={handleGenerate}
            className="btn-primary px-5 py-2 text-xs"
          >
            Generate retention plan now
          </button>
        </div>
      )}

      {plan && currentSaved && (
        <div className="flex flex-col gap-4">
          <section className="card-surface p-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[var(--brown)]">
                Summary — {evidenceBundle?.evidencePack.scope.label ?? plan.scope.id}
              </h2>
              <span className="text-[11px] font-medium text-[var(--muted)]">
                {currentSaved.source === 'playbook_fallback'
                  ? 'Generated from HR playbooks (AI unavailable)'
                  : 'Evidence-grounded Gemini synthesis'} · Decision support, requires human review
              </span>
            </div>
            <p className="text-xs text-[var(--brown)] leading-relaxed">{plan.summary}</p>
            {previousSnapshot && evidenceBundle && (
              <div className="mt-2 pt-2 border-t border-[var(--border)] flex flex-wrap gap-4 text-xs tabular-nums">
                <span className="font-semibold text-[var(--brown)]">
                  KPI Impact Tracker vs Previous Upload ({previousSnapshot.fileName}):
                </span>
                {(() => {
                  const prevScope =
                    scopeType === 'company'
                      ? previousSnapshot.employees
                      : scopeType === 'team'
                      ? previousSnapshot.employees.filter((e) => e.department === scopeId)
                      : previousSnapshot.employees.filter((e) => e.employeeId === scopeId);
                  if (prevScope.length === 0) {
                    return <span className="text-[var(--muted)]">No matching baseline rows in previous upload.</span>;
                  }
                  const prevAvgRisk = Math.round(
                    prevScope.reduce((a, b) => a + b.riskScore, 0) / prevScope.length
                  );
                  const prevAvgEng = Math.round(
                    prevScope.reduce((a, b) => a + b.engagementPct, 0) / prevScope.length
                  );
                  const currAvgEng = Math.round(
                    evidenceBundle.targetEmployees.reduce((a, b) => a + b.engagementPct, 0) /
                      Math.max(1, evidenceBundle.targetEmployees.length)
                  );
                  const riskDiff = evidenceBundle.evidencePack.avgRiskScore - prevAvgRisk;
                  const engDiff = currAvgEng - prevAvgEng;
                  return (
                    <>
                      <span>
                        Avg Risk: {prevAvgRisk} → <strong>{evidenceBundle.evidencePack.avgRiskScore}</strong>{' '}
                        <span className={riskDiff <= 0 ? 'text-[var(--olive-text)]' : 'text-[var(--risk-critical)]'}>
                          ({riskDiff > 0 ? `+${riskDiff}` : riskDiff})
                        </span>
                      </span>
                      <span>
                        Avg Engagement: {prevAvgEng}% → <strong>{currAvgEng}%</strong>{' '}
                        <span className={engDiff >= 0 ? 'text-[var(--olive-text)]' : 'text-[var(--risk-critical)]'}>
                          ({engDiff > 0 ? `+${engDiff}%` : `${engDiff}%`})
                        </span>
                      </span>
                    </>
                  );
                })()}
              </div>
            )}
            {evidenceBundle?.evidencePack.topTeamsByRisk && (
              <div className="mt-2 pt-2 border-t border-[var(--border)] flex flex-wrap gap-3 text-xs">
                <span className="font-semibold text-[var(--brown)]">Highest risk teams:</span>
                {evidenceBundle.evidencePack.topTeamsByRisk.map((t) => (
                  <span key={t.team} className="text-[var(--muted)] tabular-nums">
                    {t.team} (avg {t.avgRisk}, {t.highCriticalCount} High/Crit)
                  </span>
                ))}
              </div>
            )}
          </section>

          {planOnPage ? (
            <section className="card-surface p-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-[var(--brown)] mb-3">
                Manager Plan on a Page
              </h3>
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--cream)] text-[var(--brown)]">
                    <th className="px-3 py-2 border-b border-[var(--border)]">Priority</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">Action</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">First Step & Owner</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">Simulated Score</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">KPI Target</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/60">
                  {plan.recommendations.map((rec) => {
                    const st = currentSaved.actionStatuses[rec.id]?.status ?? 'Not started';
                    return (
                      <tr key={rec.id}>
                        <td className="px-3 py-2 font-semibold">{rec.priority}</td>
                        <td className="px-3 py-2 font-medium">{rec.title}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">
                          {rec.steps[0] ? `${rec.steps[0].owner} (${rec.steps[0].dueInDays}d): ${rec.steps[0].action}` : '-'}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {rec.expectedImpact.riskScoreBefore} → {rec.expectedImpact.riskScoreAfter}
                        </td>
                        <td className="px-3 py-2">
                          {rec.kpis[0] ? `${rec.kpis[0].name}: ${rec.kpis[0].baseline} → ${rec.kpis[0].target}` : '-'}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={st}
                            onChange={(e) =>
                              updateActionStatus(rec.id, {
                                status: e.target.value as 'Not started' | 'In progress' | 'Done' | 'Dismissed',
                              })
                            }
                            className="h-7 px-2 rounded border border-[var(--border)] bg-[var(--surface)]"
                          >
                            <option value="Not started">Not started</option>
                            <option value="In progress">In progress</option>
                            <option value="Done">Done</option>
                            <option value="Dismissed">Dismissed</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {plan.recommendations.map((rec) => {
                const statusState = currentSaved.actionStatuses[rec.id] ?? { status: 'Not started' };
                return (
                  <article key={rec.id} className="card-surface p-4 lg:p-5 flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-xs">
                          <span
                            className={`px-2 py-0.5 rounded font-semibold ${
                              rec.priority === 'P1'
                                ? 'bg-[var(--risk-critical)] text-[var(--surface)]'
                                : rec.priority === 'P2'
                                ? 'bg-[var(--amber)] text-[var(--ink-on-amber)]'
                                : 'bg-[var(--cream)] text-[var(--brown)]'
                            }`}
                          >
                            {rec.priority} ({rec.priority === 'P1' ? 'Within 7 days' : rec.priority === 'P2' ? 'Within 30 days' : 'Within 90 days'})
                          </span>
                          <span className="text-[var(--muted)]">Effort: {rec.effort}</span>
                          <span className="text-[var(--muted)] tabular-nums">
                            Simulated score: {rec.expectedImpact.riskScoreBefore} → {rec.expectedImpact.riskScoreAfter} (simulation, not a guarantee)
                          </span>
                        </div>
                        <h3 className="text-base font-semibold text-[var(--brown)] mt-1.5">
                          {rec.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-2 no-print">
                        <CheckSquare className="w-3.5 h-3.5 text-[var(--muted)]" aria-hidden="true" />
                        <select
                          value={statusState.status}
                          onChange={(e) =>
                            updateActionStatus(rec.id, {
                              status: e.target.value as 'Not started' | 'In progress' | 'Done' | 'Dismissed',
                            })
                          }
                          aria-label={`Status for ${rec.title}`}
                          className="h-8 px-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs"
                        >
                          <option value="Not started">Not started</option>
                          <option value="In progress">In progress</option>
                          <option value="Done">Done</option>
                          <option value="Dismissed">Dismissed</option>
                        </select>
                        <input
                          type="text"
                          placeholder="Assign owner"
                          value={statusState.owner ?? ''}
                          onChange={(e) => updateActionStatus(rec.id, { owner: e.target.value })}
                          className="h-8 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs w-32"
                        />
                      </div>
                    </div>

                    <p className="text-xs text-[var(--brown)]">{rec.rationale}</p>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/35 p-3">
                        <p className="font-semibold text-[var(--brown)] mb-1.5">Implementation Steps</p>
                        <ol className="space-y-1.5">
                          {rec.steps.map((s) => (
                            <li key={s.order} className="text-[var(--brown)]">
                              <strong className="tabular-nums">{s.order}.</strong> {s.action}{' '}
                              <span className="text-[var(--muted)]">
                                ({s.owner} · Due in {s.dueInDays} days)
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>

                      <div className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/35 p-3">
                        <p className="font-semibold text-[var(--brown)] mb-1.5">Measurable KPIs</p>
                        <ul className="space-y-1.5">
                          {rec.kpis.map((k, idx) => (
                            <li key={idx} className="text-[var(--brown)]">
                              <strong>{k.name}:</strong> {k.baseline} → {k.target}{' '}
                              <span className="text-[var(--muted)]">
                                (Review {k.reviewDate})
                              </span>
                            </li>
                          ))}
                        </ul>
                        {rec.risks.length > 0 && (
                          <p className="text-[11px] text-[var(--risk-high)] mt-2">
                            Watch out for: {rec.risks[0]}
                          </p>
                        )}
                      </div>
                    </div>

                    {rec.conversationGuide && rec.conversationGuide.length > 0 && (
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                        <p className="font-semibold text-[var(--brown)] mb-1">
                          Manager 1:1 Conversation Guide
                        </p>
                        <ul className="space-y-1 text-[var(--muted)]">
                          {rec.conversationGuide.map((q, i) => (
                            <li key={i}>• &ldquo;{q}&rdquo;</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {/* Monitoring & Limitations */}
          <section className="card-surface p-4 text-xs text-[var(--muted)] flex flex-col gap-1">
            <p className="text-[var(--brown)]">
              <strong>Monitoring Plan:</strong> {plan.monitoringPlan.reviewCadence}{' '}
              {plan.monitoringPlan.escalationTrigger}
            </p>
            <p>Limitations: {plan.limitations.join(' · ')}</p>
          </section>
        </div>
      )}
    </div>
  );
};
