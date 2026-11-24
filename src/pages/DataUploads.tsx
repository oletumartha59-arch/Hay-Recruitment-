import React, { useState } from 'react';
import { CheckCircle2, Download, History, Upload, Wrench } from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { UploadWizard } from '../components/UploadWizard';
import { formatUkDate } from '../lib/clean/dates';
import { computeSnapshotDiff } from '../lib/metrics';
import { exportDataQualityReport } from '../lib/reports/exports';

export const DataUploadsPage: React.FC = () => {
  const {
    snapshots,
    activeSnapshot,
    previousSnapshot,
    privacyMode,
    switchActiveSnapshot,
    reconcileAllTasks,
  } = useWorkforce();

  const [uploadOpen, setUploadOpen] = useState(false);

  const report = activeSnapshot?.dataQualityReport;
  const diff = activeSnapshot
    ? computeSnapshotDiff(activeSnapshot.employees, previousSnapshot?.employees)
    : null;

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5 max-w-[1400px] w-full mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-page-title text-2xl font-semibold text-[var(--brown)]">
            Data Quality & Upload History
          </h1>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Inspect every cleaning rule applied, resolve integrity flags, and compare or roll back up to 12 saved snapshots.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {report && activeSnapshot && (
            <button
              type="button"
              onClick={() =>
                exportDataQualityReport({
                  format: 'csv',
                  report,
                  sourceFile: activeSnapshot.fileName,
                  uploadDate: activeSnapshot.uploadedAt.slice(0, 10),
                  privacyMode,
                })
              }
              className="btn-secondary px-3 py-2 text-xs inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export problem rows & log (CSV)
            </button>
          )}
          <button
            type="button"
            onClick={() => setUploadOpen((v) => !v)}
            className="btn-primary px-4 py-2 text-xs inline-flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            Upload new data
          </button>
        </div>
      </div>

      {uploadOpen && <UploadWizard onClose={() => setUploadOpen(false)} />}

      {!activeSnapshot || !report ? (
        <div className="card-surface p-8 text-center">
          <p className="text-sm font-medium text-[var(--brown)]">No datasets saved yet.</p>
          <p className="text-xs text-[var(--muted)] mt-1">
            Click &ldquo;Upload new data&rdquo; above to run the 4-step import and cleaning wizard.
          </p>
        </div>
      ) : (
        <>
          {/* Data Quality Score & 5 Dimensions */}
          <section className="card-surface p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--brown)]">
                  Data Quality Score: {report.overallScore} / 100
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  {report.ambiguousDateAssumption}
                </p>
              </div>
              <span className="text-xs text-[var(--muted)] tabular-nums">
                Read {report.totalRowsRead.toLocaleString()} · Saved {report.validRowsSaved.toLocaleString()} · Rejected {report.rejectedRows.length}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {(
                [
                  ['Completeness', report.dimensions.completeness],
                  ['Validity', report.dimensions.validity],
                  ['Uniqueness', report.dimensions.uniqueness],
                  ['Consistency', report.dimensions.consistency],
                  ['Freshness', report.dimensions.freshness],
                ] as const
              ).map(([label, score]) => (
                <div
                  key={label}
                  className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/35 p-3"
                >
                  <p className="text-xs text-[var(--muted)]">{label}</p>
                  <p className="text-xl font-semibold tabular-nums text-[var(--brown)]">{score}%</p>
                </div>
              ))}
            </div>
          </section>

          {/* Integrity Rule Failures */}
          <section className="card-surface p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--brown)]">
                Integrity Rule Checks ({report.ruleFailures.length})
              </h2>
              {report.ruleFailures.some((r) => r.rule === 'Task count reconciliation') && (
                <button
                  type="button"
                  onClick={reconcileAllTasks}
                  className="btn-primary px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
                >
                  <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                  One-click fix: Recalculate Total Tasks
                </button>
              )}
            </div>

            {report.ruleFailures.length === 0 ? (
              <p className="text-xs text-[var(--olive-text)] inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                All integrity rules passed with zero failures.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--cream)] text-[var(--brown)]">
                      <th className="px-3 py-2 border-b border-[var(--border)]">Rule</th>
                      <th className="px-3 py-2 border-b border-[var(--border)]">Affected Rows</th>
                      <th className="px-3 py-2 border-b border-[var(--border)]">Description</th>
                      <th className="px-3 py-2 border-b border-[var(--border)]">Sample IDs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]/60">
                    {report.ruleFailures.map((rf) => (
                      <tr key={rf.rule}>
                        <td className="px-3 py-2 font-semibold">{rf.rule}</td>
                        <td className="px-3 py-2 tabular-nums text-[var(--risk-high)] font-semibold">{rf.count}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">{rf.description}</td>
                        <td className="px-3 py-2 font-mono">{rf.sampleIds.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Cleaning Decisions Log */}
          <section className="card-surface p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-[var(--brown)]">
              Cleaning Decisions Applied ({report.cleaningDecisions.length} rules)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--cream)] text-[var(--brown)]">
                    <th className="px-3 py-2 border-b border-[var(--border)]">Rule</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">Affected</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">Sample Transformations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/60">
                  {report.cleaningDecisions.map((d) => (
                    <tr key={d.id}>
                      <td className="px-3 py-2 font-semibold whitespace-nowrap">{d.ruleName}</td>
                      <td className="px-3 py-2 tabular-nums">{d.affectedCount}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[var(--muted)]">
                        {d.samples
                          .slice(0, 3)
                          .map((s) => `${s.employeeId} ${s.field}: "${s.from}" -> "${s.to}"`)
                          .join(' | ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Upload History (12 snapshots) */}
          <section className="card-surface p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--brown)] inline-flex items-center gap-2">
                <History className="w-4 h-4" aria-hidden="true" />
                Upload History ({snapshots.length} of 12 snapshots retained)
              </h2>
              {diff && (
                <span className="text-xs text-[var(--muted)] tabular-nums">
                  vs previous: +{diff.added} added, -{diff.removed} removed, {diff.statusChanged} status changed
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--cream)] text-[var(--brown)]">
                    <th className="px-3 py-2 border-b border-[var(--border)]">Source File</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">Uploaded</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">Employees</th>
                    <th className="px-3 py-2 border-b border-[var(--border)]">Quality Score</th>
                    <th className="px-3 py-2 border-b border-[var(--border)] text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/60">
                  {snapshots.map((snap) => {
                    const isCurrent = snap.id === activeSnapshot.id;
                    return (
                      <tr key={snap.id} className={isCurrent ? 'bg-[var(--olive-tint)]/35' : ''}>
                        <td className="px-3 py-2 font-medium">
                          {snap.fileName}
                          {snap.isDemo && (
                            <span className="ml-2 text-[10px] font-semibold text-[var(--ink-on-amber)]">
                              (Demo data)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatUkDate(snap.uploadedAt.slice(0, 10))}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{snap.rowCount.toLocaleString()}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {snap.dataQualityReport.overallScore}/100
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isCurrent ? (
                            <span className="text-[var(--olive-text)] font-semibold">Active</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => switchActiveSnapshot(snap.id)}
                              className="font-semibold underline text-[var(--brown)]"
                            >
                              Roll back to snapshot
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
