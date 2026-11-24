import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, RotateCcw, Trash2 } from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { exportAllDataAsJson } from '../lib/db/database';
import { normalizeSettingsWeights } from '../lib/demo/generator';
import { enrichSignalsAndScores } from '../lib/features/signals';
import { DEFAULT_SETTINGS, type WorkStatus, type WorkforceSettings } from '../types/workforce';

export const SettingsPage: React.FC = () => {
  const {
    allEmployees,
    settings,
    updateSettings,
    clearAllData,
    pushToast,
  } = useWorkforce();

  const [draft, setDraft] = useState<WorkforceSettings>(settings);
  const [newAliasRaw, setNewAliasRaw] = useState('');
  const [newAliasTarget, setNewAliasTarget] = useState<WorkStatus>('Present');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Live preview of how many employees would change risk band with draft thresholds/weights
  const bandChangesCount = useMemo(() => {
    if (allEmployees.length === 0) return 0;
    const simulated = enrichSignalsAndScores(allEmployees, draft);
    let diff = 0;
    for (let i = 0; i < allEmployees.length; i++) {
      if (allEmployees[i].riskBand !== simulated[i].riskBand) diff += 1;
    }
    return diff;
  }, [allEmployees, draft]);

  const moveLevel = (idx: number, dir: -1 | 1) => {
    const next = [...draft.jobLevelOrder];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setDraft((p) => ({ ...p, jobLevelOrder: next }));
  };

  const handleSave = async () => {
    await updateSettings(draft);
  };

  const handleResetDefaults = async () => {
    setDraft(DEFAULT_SETTINGS);
    await updateSettings(DEFAULT_SETTINGS);
  };

  const handleExportAllJson = async () => {
    const json = await exportAllDataAsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hay-workforce-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    pushToast('Exported all saved IndexedDB data as JSON.', 'success');
  };

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5 max-w-[1200px] w-full mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-page-title text-2xl font-semibold text-[var(--brown)]">
            Settings & Model Configuration
          </h1>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Customise signal thresholds, Job Level order, Risk Index weights, AI privacy controls, and saved data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="btn-secondary px-3 py-2 text-xs inline-flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Reset to defaults
          </button>
          <button type="button" onClick={handleSave} className="btn-primary px-4 py-2 text-xs">
            Save settings
          </button>
        </div>
      </div>

      {allEmployees.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--amber-tint)]/55 px-4 py-2.5 text-xs text-[var(--ink-on-amber)]">
          Live band preview: <strong className="tabular-nums">{bandChangesCount}</strong> employee(s) would change Risk Band under your unsaved draft thresholds and weights.
        </div>
      )}

      {/* Thresholds */}
      <section className="card-surface p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-[var(--brown)]">
          Warning-Sign Thresholds
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block font-medium text-[var(--brown)] mb-1">
              Low engagement (% of scale)
            </label>
            <input
              type="number"
              min={10}
              max={95}
              value={draft.lowEngagementPct}
              onChange={(e) => setDraft((p) => ({ ...p, lowEngagementPct: Number(e.target.value) }))}
              className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] tabular-nums"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Default 60%. Flags warning signal.</p>
          </div>

          <div>
            <label className="block font-medium text-[var(--brown)] mb-1">
              Critical engagement (% of scale)
            </label>
            <input
              type="number"
              min={5}
              max={80}
              value={draft.criticalEngagementPct}
              onChange={(e) =>
                setDraft((p) => ({ ...p, criticalEngagementPct: Number(e.target.value) }))
              }
              className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] tabular-nums"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Default 40%. Flags critical signal.</p>
          </div>

          <div>
            <label className="block font-medium text-[var(--brown)] mb-1">
              Heavy workload overdue share (%)
            </label>
            <input
              type="number"
              min={5}
              max={95}
              value={draft.heavyWorkloadOverduePct}
              onChange={(e) =>
                setDraft((p) => ({ ...p, heavyWorkloadOverduePct: Number(e.target.value) }))
              }
              className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] tabular-nums"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Default 30% overdue tasks.</p>
          </div>

          <div>
            <label className="block font-medium text-[var(--brown)] mb-1">
              Open tasks peer percentile
            </label>
            <input
              type="number"
              min={50}
              max={99}
              value={draft.heavyWorkloadPercentile}
              onChange={(e) =>
                setDraft((p) => ({ ...p, heavyWorkloadPercentile: Number(e.target.value) }))
              }
              className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] tabular-nums"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Default 75th percentile within peers.</p>
          </div>

          <div>
            <label className="block font-medium text-[var(--brown)] mb-1">
              Stale record threshold (days)
            </label>
            <input
              type="number"
              min={7}
              max={180}
              value={draft.staleDaysThreshold}
              onChange={(e) =>
                setDraft((p) => ({ ...p, staleDaysThreshold: Number(e.target.value) }))
              }
              className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] tabular-nums"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Default 30 days since Last Updated.</p>
          </div>

          <div>
            <label className="block font-medium text-[var(--brown)] mb-1">
              Small-sample minimum peers
            </label>
            <input
              type="number"
              min={2}
              max={20}
              value={draft.smallSampleThreshold}
              onChange={(e) =>
                setDraft((p) => ({ ...p, smallSampleThreshold: Number(e.target.value) }))
              }
              className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] tabular-nums"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Default 5 employees per group.</p>
          </div>
        </div>
      </section>

      {/* Risk Index Weights */}
      <section className="card-surface p-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--brown)]">
            Retention Risk Index Formula Weights (Always sum to 100%)
          </h2>
          <span className="text-xs font-mono text-[var(--muted)]">
            {draft.riskWeights.engagement}% Eng + {draft.riskWeights.workload}% Load +{' '}
            {draft.riskWeights.delivery}% Delivery + {draft.riskWeights.tenure}% Tenure = 100%
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {(
            [
              ['engagement', 'Engagement Risk'],
              ['workload', 'Workload Pressure'],
              ['delivery', 'Delivery Risk'],
              ['tenure', 'Tenure Risk'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <div className="flex justify-between mb-1">
                <span className="font-medium text-[var(--brown)]">{label}</span>
                <span className="tabular-nums font-semibold">{draft.riskWeights[key]}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.riskWeights[key]}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    riskWeights: normalizeSettingsWeights(
                      p.riskWeights,
                      key,
                      Number(e.target.value)
                    ),
                  }))
                }
                className="w-full accent-[var(--amber)]"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Scales, Job Level Order & Status Aliases */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card-surface p-5 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-[var(--brown)]">
            Engagement Scale & Job Level Order
          </h2>
          <div className="text-xs">
            <label className="block font-medium text-[var(--brown)] mb-1">
              Engagement Score maximum override (leave blank for auto-detect)
            </label>
            <input
              type="number"
              min={5}
              max={1000}
              placeholder="Auto-detect (e.g. 10 or 100)"
              value={draft.engagementScaleOverride ?? ''}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  engagementScaleOverride: e.target.value ? Number(e.target.value) : null,
                }))
              }
              className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] tabular-nums"
            />
          </div>

          <div className="text-xs">
            <p className="font-medium text-[var(--brown)] mb-1.5">Job Level Seniority Order</p>
            <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
              {draft.jobLevelOrder.map((lvl, idx) => (
                <div key={lvl} className="px-3 py-1.5 flex items-center justify-between">
                  <span className="tabular-nums">
                    {idx + 1}. {lvl}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveLevel(idx, -1)}
                      aria-label={`Move ${lvl} up`}
                      className="p-1 rounded hover:bg-[var(--cream)]"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveLevel(idx, 1)}
                      aria-label={`Move ${lvl} down`}
                      className="p-1 rounded hover:bg-[var(--cream)]"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card-surface p-5 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-[var(--brown)]">
            Custom Work Status Alias Dictionary
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Map any unrecognised status string in your uploads to Present, Remote, Leave, or Absent.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Source text (e.g. Client Site)"
              value={newAliasRaw}
              onChange={(e) => setNewAliasRaw(e.target.value)}
              className="flex-1 h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs"
            />
            <select
              value={newAliasTarget}
              onChange={(e) => setNewAliasTarget(e.target.value as WorkStatus)}
              className="h-9 px-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs"
            >
              <option value="Present">Present</option>
              <option value="Remote">Remote</option>
              <option value="Leave">Leave</option>
              <option value="Absent">Absent</option>
            </select>
            <button
              type="button"
              onClick={() => {
                if (!newAliasRaw.trim()) return;
                setDraft((p) => ({
                  ...p,
                  statusAliases: {
                    ...p.statusAliases,
                    [newAliasRaw.trim().toLowerCase()]: newAliasTarget,
                  },
                }));
                setNewAliasRaw('');
              }}
              className="btn-secondary px-3 text-xs"
            >
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(draft.statusAliases).map(([k, v]) => (
              <span
                key={k}
                className="px-2 py-1 rounded bg-[var(--cream)] border border-[var(--border)] inline-flex items-center gap-1.5"
              >
                &ldquo;{k}&rdquo; → {v}
                <button
                  type="button"
                  onClick={() => {
                    const copy = { ...draft.statusAliases };
                    delete copy[k];
                    setDraft((p) => ({ ...p, statusAliases: copy }));
                  }}
                  className="text-[var(--risk-critical)] font-bold"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* AI & Privacy Settings */}
      <section className="card-surface p-5 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-[var(--brown)]">AI & UK GDPR Privacy Controls</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-medium text-[var(--brown)] mb-1">Gemini model</label>
            <select
              value={draft.geminiModel}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  geminiModel: e.target.value as WorkforceSettings['geminiModel'],
                }))
              }
              className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]"
            >
              <option value="gemini-4-hydrogen">Gemini 4 Flash (Default)</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Fastest)</option>
              <option value="gemini-4-neon">Gemini 4 Pro (Complex reasoning)</option>
            </select>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.privacyModeDefault}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, privacyModeDefault: e.target.checked }))
                }
                className="accent-[var(--amber)]"
              />
              <span>Enable Privacy Mode by default (mask employee names)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.includeNamesInAI}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, includeNamesInAI: e.target.checked }))
                }
                className="accent-[var(--amber)]"
              />
              <span>Include employee names in AI requests (off by default)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.aiExplanationsEnabled}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, aiExplanationsEnabled: e.target.checked }))
                }
                className="accent-[var(--amber)]"
              />
              <span>Enable AI explanations & recommendations</span>
            </label>
          </div>
        </div>
      </section>

      {/* Data Management */}
      <section className="card-surface p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--brown)]">Saved Browser Data</h2>
          <p className="text-xs text-[var(--muted)]">
            Export a full JSON backup of all snapshots, models, and settings, or wipe local storage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportAllJson}
            className="btn-secondary px-3 py-2 text-xs inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Export all data (JSON)
          </button>
          <button
            type="button"
            onClick={() => setConfirmClearOpen(true)}
            className="px-3 py-2 rounded-lg border border-[var(--risk-critical)] text-xs font-semibold text-[var(--risk-critical)] hover:bg-[var(--oxblood-tint)] inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            Clear all data
          </button>
        </div>
      </section>

      {confirmClearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true">
          <div className="card-surface p-5 max-w-md w-full flex flex-col gap-3">
            <h3 className="font-semibold text-sm text-[var(--risk-critical)]">
              Confirm clearing all saved data
            </h3>
            <p className="text-xs text-[var(--brown)]">
              This will permanently remove all uploaded workforce snapshots, trained models, recommendations, and chat history from IndexedDB.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await clearAllData();
                  setConfirmClearOpen(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-[var(--risk-critical)] text-[var(--surface)] text-xs font-semibold"
              >
                Yes, clear everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
