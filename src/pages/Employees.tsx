import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Columns3,
  Download,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { FilterBar } from '../components/FilterBar';
import { ProfileDrawer } from '../components/ProfileDrawer';
import {
  AttentionChip,
  RiskBandChip,
  SignalIconBadge,
  WorkStatusChip,
  WorkloadChip,
} from '../components/StatusChip';
import { formatTenure, formatUkDate } from '../lib/clean/dates';
import { maskEmployeeName } from '../lib/metrics';
import { exportEmployeeDetails } from '../lib/reports/exports';
import type { EmployeeRecord } from '../types/workforce';

interface SortRule {
  id: string;
  desc: boolean;
}

interface TableColumn {
  id: string;
  label: string;
  width: number;
  sortable?: boolean;
  sortValue?: (row: EmployeeRecord) => string | number;
  render: (row: EmployeeRecord) => React.ReactNode;
}

export const EmployeesPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    allEmployees,
    filteredEmployees,
    activeSnapshot,
    settings,
    privacyMode,
    filters,
    clearFilters,
    pushToast,
  } = useWorkforce();

  const [sorting, setSorting] = useState<SortRule[]>([{ id: 'riskScore', desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('hay_table_visibility');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerEmployee, setDrawerEmployee] = useState<EmployeeRecord | null>(null);

  const scaleMax = activeSnapshot?.engagementScaleMax ?? 10;

  const toggleRowSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (selectedIds.size === filteredEmployees.length && filteredEmployees.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEmployees.map((e) => e.employeeId)));
    }
  };

  const columns = useMemo<TableColumn[]>(
    () => [
      {
        id: 'select',
        label: '',
        width: 44,
        sortable: false,
        render: (e) => (
          <input
            type="checkbox"
            checked={selectedIds.has(e.employeeId)}
            onChange={(ev) => {
              ev.stopPropagation();
              toggleRowSelection(e.employeeId);
            }}
            onClick={(ev) => ev.stopPropagation()}
            aria-label={`Select ${e.employeeId}`}
            className="accent-[var(--amber)]"
          />
        ),
      },
      {
        id: 'employeeName',
        label: 'Employee',
        width: 195,
        sortable: true,
        sortValue: (e) => maskEmployeeName(e.employeeName, e.employeeId, privacyMode),
        render: (e) => (
          <div className="min-w-0">
            <div className="font-semibold text-[var(--brown)] truncate">
              {maskEmployeeName(e.employeeName, e.employeeId, privacyMode)}
            </div>
            <div className="text-[11px] font-mono text-[var(--muted)]">{e.employeeId}</div>
          </div>
        ),
      },
      {
        id: 'department',
        label: 'Department',
        width: 155,
        sortable: true,
        sortValue: (e) => e.department,
        render: (e) => e.department,
      },
      {
        id: 'jobLevel',
        label: 'Job Level',
        width: 140,
        sortable: true,
        sortValue: (e) => e.jobLevelRank,
        render: (e) => e.jobLevel,
      },
      {
        id: 'location',
        label: 'Location',
        width: 110,
        sortable: true,
        sortValue: (e) => e.location,
        render: (e) => e.location,
      },
      {
        id: 'workArrangement',
        label: 'Arrangement',
        width: 105,
        sortable: true,
        sortValue: (e) => e.workArrangement,
        render: (e) => e.workArrangement,
      },
      {
        id: 'workStatus',
        label: 'Work Status',
        width: 115,
        sortable: true,
        sortValue: (e) => e.workStatus,
        render: (e) => <WorkStatusChip status={e.workStatus} />,
      },
      {
        id: 'hireDate',
        label: 'Hire Date / Tenure',
        width: 125,
        sortable: true,
        sortValue: (e) => e.hireDate,
        render: (e) => (
          <div className="tabular-nums text-xs">
            <div>{formatUkDate(e.hireDate)}</div>
            <div className="text-[11px] text-[var(--muted)]">
              {formatTenure(e.tenureMonths)}
            </div>
          </div>
        ),
      },
      {
        id: 'lastUpdated',
        label: 'Last Updated',
        width: 135,
        sortable: true,
        sortValue: (e) => e.lastUpdated,
        render: (e) => (
          <div className="tabular-nums text-xs">
            <span>{formatUkDate(e.lastUpdated)}</span>
            {e.isStale && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[var(--sienna-tint)] text-[var(--risk-high)] text-[10px] font-semibold">
                Stale
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'tasks',
        label: 'Tasks (C/P/O/T)',
        width: 160,
        sortable: true,
        sortValue: (e) => e.openTasks,
        render: (e) => {
          const tot = Math.max(1, e.totalTasks);
          const cPct = Math.round((e.completedTasks / tot) * 100);
          const pPct = Math.round((e.pendingTasks / tot) * 100);
          const oPct = Math.max(0, 100 - cPct - pPct);
          return (
            <div className="w-36">
              <div className="flex items-center justify-between text-[11px] tabular-nums mb-1">
                <span>
                  {e.completedTasks}/{e.pendingTasks}/{e.overdueTasks}/{e.totalTasks}
                </span>
                {!e.dataQuality.taskReconciled && (
                  <span
                    title="Task counts do not reconcile (Completed + Pending + Overdue != Total)"
                    className="text-[var(--risk-critical)]"
                  >
                    <AlertTriangle className="w-3 h-3" />
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-[var(--cream)]">
                <div style={{ width: `${cPct}%` }} className="bg-[var(--olive)]" />
                <div style={{ width: `${pPct}%` }} className="bg-[var(--amber)]" />
                <div style={{ width: `${oPct}%` }} className="bg-[var(--risk-high)]" />
              </div>
            </div>
          );
        },
      },
      {
        id: 'engagementScore',
        label: 'Engagement',
        width: 130,
        sortable: true,
        sortValue: (e) => e.engagementPct,
        render: (e) => {
          const isLow = e.engagementPct < settings.lowEngagementPct;
          const imputed = e.dataQuality.imputedFields.includes('engagementScore');
          return (
            <div className="w-28">
              <div className="flex items-center gap-1 text-xs tabular-nums font-medium">
                <span className={isLow ? 'text-[var(--risk-critical)] font-semibold' : ''}>
                  {e.engagementScore}/{scaleMax}
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  ({Math.round(e.engagementPct)}%)
                </span>
                {imputed && (
                  <span
                    title="Imputed from peer median"
                    className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] inline-block"
                  />
                )}
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--cream)] overflow-hidden mt-1">
                <div
                  style={{ width: `${Math.min(100, e.engagementPct)}%` }}
                  className={isLow ? 'h-full bg-[var(--risk-critical)]' : 'h-full bg-[var(--olive)]'}
                />
              </div>
            </div>
          );
        },
      },
      {
        id: 'workloadLevel',
        label: 'Workload',
        width: 95,
        sortable: true,
        sortValue: (e) => (e.workloadLevel === 'High' ? 3 : e.workloadLevel === 'Medium' ? 2 : 1),
        render: (e) => <WorkloadChip level={e.workloadLevel} />,
      },
      {
        id: 'leaveDaysRemaining',
        label: 'Leave Days',
        width: 95,
        sortable: true,
        sortValue: (e) => e.leaveDaysRemaining,
        render: (e) => (
          <span className="tabular-nums inline-flex items-center gap-1">
            {e.leaveDaysRemaining}
            {e.dataQuality.imputedFields.includes('leaveDaysRemaining') && (
              <span
                title="Imputed from peer median"
                className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] inline-block"
              />
            )}
          </span>
        ),
      },
      {
        id: 'attentionStatus',
        label: 'Attention & Reason',
        width: 215,
        sortable: true,
        sortValue: (e) => (e.needsAttentionFlag ? 1 : 0),
        render: (e) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <AttentionChip status={e.attentionStatus} />
              {e.missedByCurrentProcess && (
                <span className="text-[10px] font-semibold text-[var(--risk-critical)]">
                  Missed by current process
                </span>
              )}
            </div>
            {e.attentionReasonTags.length > 0 && (
              <div className="text-[11px] text-[var(--muted)] truncate max-w-[200px]">
                {e.attentionReasonTags.join(' · ')}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'riskScore',
        label: 'Risk Score',
        width: 130,
        sortable: true,
        sortValue: (e) => e.riskScore,
        render: (e) => (
          <div className="flex items-center gap-1.5">
            <RiskBandChip band={e.riskBand} score={e.riskScore} />
            {e.riskDelta !== null && e.riskDelta !== 0 && (
              <span
                className={`text-[11px] tabular-nums font-semibold inline-flex items-center ${
                  e.riskDelta > 0 ? 'text-[var(--risk-critical)]' : 'text-[var(--olive-text)]'
                }`}
              >
                {e.riskDelta > 0 ? (
                  <ArrowUp className="w-3 h-3" />
                ) : (
                  <ArrowDown className="w-3 h-3" />
                )}
                {Math.abs(e.riskDelta)}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'signals',
        label: 'Signals',
        width: 145,
        sortable: true,
        sortValue: (e) => e.signals.length,
        render: (e) => (
          <div className="flex items-center gap-1 flex-wrap">
            {e.signals.slice(0, 4).map((s) => (
              <SignalIconBadge key={s.code} code={s.code} title={`${s.label}: ${s.reason}`} />
            ))}
            {e.signals.length > 4 && (
              <span className="text-[11px] text-[var(--muted)]">
                +{e.signals.length - 4}
              </span>
            )}
          </div>
        ),
      },
    ],
    [selectedIds, privacyMode, settings.lowEngagementPct, scaleMax]
  );

  const visibleColumns = useMemo(
    () => columns.filter((col) => col.id === 'select' || columnVisibility[col.id] !== false),
    [columns, columnVisibility]
  );

  const toggleColumnVisibility = (id: string) => {
    setColumnVisibility((prev) => {
      const next = { ...prev, [id]: prev[id] === false };
      try {
        localStorage.setItem('hay_table_visibility', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleSortClick = (colId: string, shiftKey: boolean) => {
    setSorting((prev) => {
      const existing = prev.find((s) => s.id === colId);
      let nextRule: SortRule | null;
      if (!existing) nextRule = { id: colId, desc: true };
      else if (existing.desc) nextRule = { id: colId, desc: false };
      else nextRule = null;

      if (shiftKey) {
        const rest = prev.filter((s) => s.id !== colId);
        return nextRule ? [...rest, nextRule] : rest;
      }
      return nextRule ? [nextRule] : [];
    });
  };

  const sortedRows = useMemo(() => {
    if (sorting.length === 0) return filteredEmployees;
    const colMap = new Map(columns.map((c) => [c.id, c]));
    return [...filteredEmployees].sort((a, b) => {
      for (const rule of sorting) {
        const col = colMap.get(rule.id);
        if (!col?.sortValue) continue;
        const va = col.sortValue(a);
        const vb = col.sortValue(b);
        let cmp = 0;
        if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb));
        }
        if (cmp !== 0) return rule.desc ? -cmp : cmp;
      }
      return 0;
    });
  }, [filteredEmployees, sorting, columns]);

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const rowHeight = density === 'compact' ? 44 : 58;

  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const handleExport = (format: 'csv' | 'xlsx') => {
    const target =
      selectedIds.size > 0
        ? sortedRows.filter((e) => selectedIds.has(e.employeeId))
        : sortedRows;

    const exportCols = visibleColumns
      .map((c) => c.id)
      .filter((id) => id !== 'select' && id !== 'tasks');

    exportEmployeeDetails({
      format,
      employees: target,
      visibleColumns: exportCols.length > 0 ? exportCols : undefined,
      privacyMode,
      filters,
      engagementScaleMax: scaleMax,
      sourceFile: activeSnapshot?.fileName ?? 'Workforce export',
    });
    pushToast(`Exported ${target.length} employee rows to ${format.toUpperCase()}.`, 'success');
  };

  if (allEmployees.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center card-surface mt-8">
        <h1 className="font-page-title text-xl font-semibold text-[var(--brown)]">
          No Employee Data Loaded
        </h1>
        <p className="text-xs text-[var(--muted)] mt-2 mb-4">
          Upload a workforce file or load the demo dataset on the Home page to explore employees.
        </p>
        <button type="button" onClick={() => navigate('/')} className="btn-primary px-4 py-2 text-xs">
          Go to Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <FilterBar />

      <div className="p-4 lg:p-6 flex flex-col gap-4 max-w-[1600px] w-full mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-page-title text-2xl font-semibold text-[var(--brown)]">
              Employees Directory
            </h1>
            <p className="text-xs text-[var(--muted)] mt-0.5 tabular-nums">
              Showing {sortedRows.length.toLocaleString()} of {allEmployees.length.toLocaleString()} employees · Click any row for profile, drivers and What-If simulator · Hold Shift + click header for multi-column sort
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  const first = Array.from(selectedIds)[0];
                  navigate(`/recommendations?scopeType=employee&scopeId=${encodeURIComponent(first)}`);
                }}
                className="btn-primary px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Plan for selected ({selectedIds.size})
              </button>
            )}

            <button
              type="button"
              onClick={() => setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable'))}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Density: {density === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setColMenuOpen((v) => !v)}
                className="btn-secondary px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
              >
                <Columns3 className="w-3.5 h-3.5" aria-hidden="true" />
                Columns
              </button>
              {colMenuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setColMenuOpen(false)} />
                  <div className="absolute right-0 top-9 z-30 w-52 card-surface p-2 shadow-sm max-h-72 overflow-y-auto">
                    {columns
                      .filter((c) => c.id !== 'select')
                      .map((col) => (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-[var(--cream)] rounded"
                        >
                          <input
                            type="checkbox"
                            checked={columnVisibility[col.id] !== false}
                            onChange={() => toggleColumnVisibility(col.id)}
                            className="accent-[var(--amber)]"
                          />
                          <span className="truncate">{col.label}</span>
                        </label>
                      ))}
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleExport('csv')}
              className="btn-secondary px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => handleExport('xlsx')}
              className="btn-secondary px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              XLSX
            </button>
          </div>
        </div>

        {sortedRows.length === 0 ? (
          <div className="card-surface p-10 text-center flex flex-col items-center gap-3">
            <p className="text-sm font-medium text-[var(--brown)]">
              No employees match these filters.
            </p>
            <button type="button" onClick={clearFilters} className="btn-primary px-4 py-2 text-xs">
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="card-surface overflow-hidden">
            <div
              ref={tableContainerRef}
              className="overflow-auto max-h-[65vh]"
              role="region"
              aria-label="Employee table"
            >
              <table className="w-full text-[13px] text-left border-collapse min-w-[1400px]">
                <thead className="sticky top-0 z-10 bg-[var(--cream)] text-[var(--brown)] text-xs">
                  <tr>
                    {visibleColumns.map((col, idx) => {
                      const sortState = sorting.find((s) => s.id === col.id);
                      return (
                        <th
                          key={col.id}
                          style={{ width: col.width }}
                          className={`px-3 py-2.5 font-semibold border-b border-[var(--border)] whitespace-nowrap select-none ${
                            idx === 1 ? 'sticky left-0 z-20 bg-[var(--cream)]' : ''
                          }`}
                        >
                          {col.id === 'select' ? (
                            <input
                              type="checkbox"
                              checked={
                                filteredEmployees.length > 0 &&
                                selectedIds.size === filteredEmployees.length
                              }
                              onChange={toggleAllVisible}
                              aria-label="Select all filtered employees"
                              className="accent-[var(--amber)]"
                            />
                          ) : col.sortable ? (
                            <button
                              type="button"
                              onClick={(e) => handleSortClick(col.id, e.shiftKey)}
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              {col.label}
                              {sortState ? (
                                sortState.desc ? (
                                  <ArrowDown className="w-3 h-3" />
                                ) : (
                                  <ArrowUp className="w-3 h-3" />
                                )
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-40" />
                              )}
                            </button>
                          ) : (
                            col.label
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody
                  style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
                >
                  {virtualizer.getVirtualItems().map((vRow) => {
                    const emp = sortedRows[vRow.index];
                    return (
                      <tr
                        key={emp.employeeId}
                        onClick={() => setDrawerEmployee(emp)}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${vRow.size}px`,
                          transform: `translateY(${vRow.start}px)`,
                          display: 'table',
                          tableLayout: 'fixed',
                        }}
                        className="border-b border-[var(--border)]/60 hover:bg-[var(--cream)]/40 cursor-pointer"
                      >
                        {visibleColumns.map((col, cIdx) => (
                          <td
                            key={col.id}
                            style={{ width: col.width }}
                            className={`px-3 py-1.5 align-middle overflow-hidden ${
                              cIdx === 1 ? 'sticky left-0 z-10 bg-[var(--surface)]' : ''
                            }`}
                          >
                            {col.render(emp)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <ProfileDrawer
        employee={drawerEmployee}
        orderedList={sortedRows}
        onSelectEmployee={setDrawerEmployee}
        onClose={() => setDrawerEmployee(null)}
      />
    </div>
  );
};
