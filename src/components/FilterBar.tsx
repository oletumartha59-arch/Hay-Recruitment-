import React, { useMemo, useState } from 'react';
import { ChevronDown, SlidersHorizontal, Undo2, X, Search } from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import type {
  AttentionStatus,
  RiskBand,
  SignalCode,
  WorkArrangement,
  WorkStatus,
  WorkloadLevel,
} from '../types/workforce';
import { TENURE_BAND_ORDER } from '../lib/metrics';

interface MultiSelectDropdownProps {
  label: string;
  options: Array<{ value: string; count: number }>;
  selected: string[];
  onChange: (next: string[]) => void;
}

const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  label,
  options,
  selected,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () =>
      options.filter((o) =>
        o.value.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [options, query]
  );

  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter((s) => s !== val));
    else onChange([...selected, val]);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
          selected.length > 0
            ? 'bg-[var(--amber-tint)] border-[var(--amber)] text-[var(--ink-on-amber)]'
            : 'bg-[var(--surface)] border-[var(--border)] text-[var(--brown)] hover:bg-[var(--cream)]'
        }`}
      >
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="tabular-nums font-semibold">({selected.length})</span>
        )}
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-10 z-30 w-64 card-surface p-2.5 shadow-sm flex flex-col gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--muted)] absolute left-2.5 top-2.5" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${label.toLowerCase()}...`}
                className="w-full h-8 pl-8 pr-2 text-xs rounded-md border border-[var(--border)] bg-[var(--cream)]/40 text-[var(--brown)]"
              />
            </div>

            <div className="flex items-center justify-between text-[11px] px-1">
              <button
                type="button"
                onClick={() => onChange(options.map((o) => o.value))}
                className="text-[var(--brown)] font-medium hover:underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[var(--muted)] hover:underline"
              >
                Clear
              </button>
            </div>

            <div className="max-h-52 overflow-y-auto flex flex-col gap-0.5">
              {filtered.length === 0 ? (
                <p className="text-xs text-[var(--muted)] px-2 py-3 text-center">
                  No options match
                </p>
              ) : (
                filtered.map((opt) => {
                  const checked = selected.includes(opt.value);
                  return (
                    <label
                      key={opt.value}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--cream)]/60 cursor-pointer text-xs text-[var(--brown)]"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(opt.value)}
                          className="accent-[var(--amber)]"
                        />
                        <span className="truncate">{opt.value}</span>
                      </span>
                      <span className="text-[var(--muted)] tabular-nums shrink-0">
                        ({opt.count})
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const FilterBar: React.FC = () => {
  const {
    allEmployees,
    filteredEmployees,
    filters,
    setFilters,
    undoFilters,
    canUndoFilters,
    clearFilters,
    cascadingCounts,
  } = useWorkforce();
  const [moreOpen, setMoreOpen] = useState(false);

  if (allEmployees.length === 0) return null;

  const activeChips: Array<{ label: string; onRemove: () => void }> = [];
  filters.departments.forEach((d) =>
    activeChips.push({
      label: `Dept: ${d}`,
      onRemove: () => setFilters((p) => ({ ...p, departments: p.departments.filter((x) => x !== d) })),
    })
  );
  filters.locations.forEach((l) =>
    activeChips.push({
      label: `Location: ${l}`,
      onRemove: () => setFilters((p) => ({ ...p, locations: p.locations.filter((x) => x !== l) })),
    })
  );
  filters.workStatuses.forEach((s) =>
    activeChips.push({
      label: `Status: ${s}`,
      onRemove: () => setFilters((p) => ({ ...p, workStatuses: p.workStatuses.filter((x) => x !== s) })),
    })
  );
  filters.jobLevels.forEach((l) =>
    activeChips.push({
      label: `Level: ${l}`,
      onRemove: () => setFilters((p) => ({ ...p, jobLevels: p.jobLevels.filter((x) => x !== l) })),
    })
  );
  filters.workArrangements.forEach((a) =>
    activeChips.push({
      label: `Arrangement: ${a}`,
      onRemove: () => setFilters((p) => ({ ...p, workArrangements: p.workArrangements.filter((x) => x !== a) })),
    })
  );
  filters.workloadLevels.forEach((w) =>
    activeChips.push({
      label: `Workload: ${w}`,
      onRemove: () => setFilters((p) => ({ ...p, workloadLevels: p.workloadLevels.filter((x) => x !== w) })),
    })
  );
  filters.attentionStatuses.forEach((a) =>
    activeChips.push({
      label: `Attention: ${a}`,
      onRemove: () => setFilters((p) => ({ ...p, attentionStatuses: p.attentionStatuses.filter((x) => x !== a) })),
    })
  );
  filters.riskBands.forEach((r) =>
    activeChips.push({
      label: `Risk: ${r}`,
      onRemove: () => setFilters((p) => ({ ...p, riskBands: p.riskBands.filter((x) => x !== r) })),
    })
  );
  filters.signalTypes.forEach((sig) =>
    activeChips.push({
      label: `Signal: ${sig.replace(/_/g, ' ')}`,
      onRemove: () => setFilters((p) => ({ ...p, signalTypes: p.signalTypes.filter((x) => x !== sig) })),
    })
  );
  filters.tenureBands.forEach((t) =>
    activeChips.push({
      label: `Tenure: ${t}`,
      onRemove: () => setFilters((p) => ({ ...p, tenureBands: p.tenureBands.filter((x) => x !== t) })),
    })
  );
  if (filters.staleOnly) {
    activeChips.push({
      label: 'Stale records only',
      onRemove: () => setFilters((p) => ({ ...p, staleOnly: false })),
    });
  }
  if (filters.engagementRange[0] > 0 || filters.engagementRange[1] < 100) {
    activeChips.push({
      label: `Engagement: ${filters.engagementRange[0]}%–${filters.engagementRange[1]}%`,
      onRemove: () => setFilters((p) => ({ ...p, engagementRange: [0, 100] })),
    });
  }
  if (filters.search) {
    activeChips.push({
      label: `Search: "${filters.search}"`,
      onRemove: () => setFilters((p) => ({ ...p, search: '' })),
    });
  }

  const extraCount =
    filters.jobLevels.length +
    filters.workArrangements.length +
    filters.workloadLevels.length +
    filters.attentionStatuses.length +
    filters.riskBands.length +
    filters.signalTypes.length +
    filters.tenureBands.length +
    (filters.staleOnly ? 1 : 0) +
    (filters.engagementRange[0] > 0 || filters.engagementRange[1] < 100 ? 1 : 0);

  const signalOptions: Array<{ value: SignalCode | 'missed_warning_signs'; label: string }> = [
    { value: 'missed_warning_signs', label: 'Missed warning sign (OK + Signal)' },
    { value: 'low_engagement', label: 'Low engagement' },
    { value: 'critical_engagement', label: 'Critically low engagement' },
    { value: 'heavy_workload', label: 'Heavy workload' },
    { value: 'severe_overload', label: 'Severe overload' },
    { value: 'burnout_pattern', label: 'Burnout pattern' },
    { value: 'delivery_slippage', label: 'Delivery slippage' },
    { value: 'unused_leave', label: 'Unused leave' },
    { value: 'early_tenure_risk', label: 'Early-tenure risk' },
    { value: 'stale_record', label: 'Stale record' },
  ];

  return (
    <div className="sticky top-0 z-10 bg-[var(--cream)]/95 backdrop-blur-sm border-b border-[var(--border)] py-2.5 px-4 lg:px-6 no-print">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelectDropdown
            label="Department"
            options={cascadingCounts.departments}
            selected={filters.departments}
            onChange={(next) => setFilters((p) => ({ ...p, departments: next }))}
          />
          <MultiSelectDropdown
            label="Location"
            options={cascadingCounts.locations}
            selected={filters.locations}
            onChange={(next) => setFilters((p) => ({ ...p, locations: next }))}
          />
          <MultiSelectDropdown
            label="Work Status"
            options={cascadingCounts.workStatuses}
            selected={filters.workStatuses}
            onChange={(next) =>
              setFilters((p) => ({ ...p, workStatuses: next as WorkStatus[] }))
            }
          />

          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
              extraCount > 0 || moreOpen
                ? 'bg-[var(--amber-tint)] border-[var(--amber)] text-[var(--ink-on-amber)]'
                : 'bg-[var(--surface)] border-[var(--border)] text-[var(--brown)] hover:bg-[var(--cream)]'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            More filters {extraCount > 0 ? `(${extraCount})` : ''}
          </button>

          {canUndoFilters && (
            <button
              type="button"
              onClick={undoFilters}
              className="h-9 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--cream)] text-xs text-[var(--brown)] inline-flex items-center gap-1.5"
              title="Undo last filter change"
            >
              <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              Undo
            </button>
          )}
        </div>

        <div className="text-xs text-[var(--muted)] tabular-nums whitespace-nowrap">
          Showing <strong className="text-[var(--brown)]">{filteredEmployees.length.toLocaleString()}</strong> of{' '}
          {allEmployees.length.toLocaleString()} employees
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {activeChips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--brown)] hover:bg-[var(--amber-tint)] transition-colors"
            >
              <span>{chip.label}</span>
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-medium text-[var(--brown)] underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {moreOpen && (
        <div className="mt-3 card-surface p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-xs font-semibold text-[var(--brown)] mb-1.5">Job Level</p>
            <div className="flex flex-wrap gap-1.5">
              {cascadingCounts.jobLevels.map((opt) => {
                const active = filters.jobLevels.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        jobLevels: active
                          ? p.jobLevels.filter((x) => x !== opt.value)
                          : [...p.jobLevels, opt.value],
                      }))
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      active
                        ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] border-[var(--amber)] font-medium'
                        : 'bg-[var(--cream)]/50 text-[var(--brown)] border-[var(--border)]'
                    }`}
                  >
                    {opt.value} ({opt.count})
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-[var(--brown)] mb-1.5">Risk Band & Attention</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(['Critical', 'High', 'Medium', 'Low'] as RiskBand[]).map((band) => {
                const active = filters.riskBands.includes(band);
                return (
                  <button
                    key={band}
                    type="button"
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        riskBands: active
                          ? p.riskBands.filter((x) => x !== band)
                          : [...p.riskBands, band],
                      }))
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      active
                        ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] border-[var(--amber)] font-medium'
                        : 'bg-[var(--cream)]/50 text-[var(--brown)] border-[var(--border)]'
                    }`}
                  >
                    {band}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['Needs Attention', 'OK'] as AttentionStatus[]).map((att) => {
                const active = filters.attentionStatuses.includes(att);
                return (
                  <button
                    key={att}
                    type="button"
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        attentionStatuses: active
                          ? p.attentionStatuses.filter((x) => x !== att)
                          : [...p.attentionStatuses, att],
                      }))
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      active
                        ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] border-[var(--amber)] font-medium'
                        : 'bg-[var(--cream)]/50 text-[var(--brown)] border-[var(--border)]'
                    }`}
                  >
                    {att}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-[var(--brown)] mb-1.5">Arrangement & Workload</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(['Office', 'Hybrid', 'Remote'] as WorkArrangement[]).map((arr) => {
                const active = filters.workArrangements.includes(arr);
                return (
                  <button
                    key={arr}
                    type="button"
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        workArrangements: active
                          ? p.workArrangements.filter((x) => x !== arr)
                          : [...p.workArrangements, arr],
                      }))
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      active
                        ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] border-[var(--amber)] font-medium'
                        : 'bg-[var(--cream)]/50 text-[var(--brown)] border-[var(--border)]'
                    }`}
                  >
                    {arr}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['Low', 'Medium', 'High'] as WorkloadLevel[]).map((wl) => {
                const active = filters.workloadLevels.includes(wl);
                return (
                  <button
                    key={wl}
                    type="button"
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        workloadLevels: active
                          ? p.workloadLevels.filter((x) => x !== wl)
                          : [...p.workloadLevels, wl],
                      }))
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      active
                        ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] border-[var(--amber)] font-medium'
                        : 'bg-[var(--cream)]/50 text-[var(--brown)] border-[var(--border)]'
                    }`}
                  >
                    {wl} load
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-[var(--brown)] mb-1.5">
              Engagement % ({filters.engagementRange[0]}%–{filters.engagementRange[1]}%)
            </p>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="range"
                min={0}
                max={100}
                value={filters.engagementRange[0]}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    engagementRange: [Math.min(Number(e.target.value), p.engagementRange[1]), p.engagementRange[1]],
                  }))
                }
                aria-label="Minimum engagement percentage"
                className="w-full accent-[var(--amber)]"
              />
              <input
                type="range"
                min={0}
                max={100}
                value={filters.engagementRange[1]}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    engagementRange: [p.engagementRange[0], Math.max(Number(e.target.value), p.engagementRange[0])],
                  }))
                }
                aria-label="Maximum engagement percentage"
                className="w-full accent-[var(--amber)]"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-[var(--brown)] cursor-pointer">
              <input
                type="checkbox"
                checked={filters.staleOnly}
                onChange={(e) => setFilters((p) => ({ ...p, staleOnly: e.target.checked }))}
                className="accent-[var(--amber)]"
              />
              Stale records only (&gt; 30 days)
            </label>
          </div>

          <div className="md:col-span-2 lg:col-span-2">
            <p className="text-xs font-semibold text-[var(--brown)] mb-1.5">Warning Signals</p>
            <div className="flex flex-wrap gap-1.5">
              {signalOptions.map((opt) => {
                const active = filters.signalTypes.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        signalTypes: active
                          ? p.signalTypes.filter((x) => x !== opt.value)
                          : [...p.signalTypes, opt.value],
                      }))
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      active
                        ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] border-[var(--amber)] font-medium'
                        : 'bg-[var(--cream)]/50 text-[var(--brown)] border-[var(--border)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="md:col-span-2 lg:col-span-2">
            <p className="text-xs font-semibold text-[var(--brown)] mb-1.5">Tenure Band</p>
            <div className="flex flex-wrap gap-1.5">
              {TENURE_BAND_ORDER.map((tb) => {
                const active = filters.tenureBands.includes(tb);
                return (
                  <button
                    key={tb}
                    type="button"
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        tenureBands: active
                          ? p.tenureBands.filter((x) => x !== tb)
                          : [...p.tenureBands, tb],
                      }))
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      active
                        ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] border-[var(--amber)] font-medium'
                        : 'bg-[var(--cream)]/50 text-[var(--brown)] border-[var(--border)]'
                    }`}
                  >
                    {tb}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
