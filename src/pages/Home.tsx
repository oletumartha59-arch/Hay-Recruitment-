import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { FilterBar } from '../components/FilterBar';
import { KpiCard } from '../components/KpiCard';
import { ChartCard } from '../components/ChartCard';
import { RiskBandChip } from '../components/StatusChip';
import { ProfileDrawer } from '../components/ProfileDrawer';
import { UploadWizard } from '../components/UploadWizard';
import { formatUkDate } from '../lib/clean/dates';
import { createBlankCsvTemplate } from '../lib/demo/generator';
import {
  aggregateByGroup,
  computeSnapshotDiff,
  generateDeptEngagementInsight,
  maskEmployeeName,
} from '../lib/metrics';
import { BRAND_TOKENS, STATUS_COLOURS } from '../theme/tokens';
import { createLeaveDecal, HORIZONTAL_GUIDE_SPLITLINE } from '../theme/echartsTheme';
import type { EmployeeRecord, WorkStatus } from '../types/workforce';
import { INITIAL_FILTER_STATE } from '../types/workforce';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    loading,
    activeSnapshot,
    previousSnapshot,
    allEmployees,
    filteredEmployees,
    kpis,
    settings,
    privacyMode,
    setPrivacyMode,
    setFilters,
    toggleFilterValue,
    loadDemoData,
  } = useWorkforce();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRecord | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);

  const handleDownloadTemplate = () => {
    const csv = createBlankCsvTemplate();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hay-workforce-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const top10AtRisk = useMemo(
    () => [...filteredEmployees].sort((a, b) => b.riskScore - a.riskScore).slice(0, 10),
    [filteredEmployees]
  );

  const deptCounts = useMemo(
    () =>
      aggregateByGroup(filteredEmployees, 'count', 'department', 'count', settings.smallSampleThreshold).sort(
        (a, b) => (b.value ?? 0) - (a.value ?? 0)
      ),
    [filteredEmployees, settings.smallSampleThreshold]
  );

  const deptEngagement = useMemo(
    () =>
      aggregateByGroup(
        filteredEmployees,
        'engagementPct',
        'department',
        'mean',
        settings.smallSampleThreshold
      ).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [filteredEmployees, settings.smallSampleThreshold]
  );

  const snapshotDiff = useMemo(
    () => computeSnapshotDiff(allEmployees, previousSnapshot?.employees),
    [allEmployees, previousSnapshot]
  );

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-24 rounded-xl bg-[var(--surface)] animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-[var(--surface)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Empty state when no data is saved
  if (!activeSnapshot || allEmployees.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        {uploadOpen ? (
          <UploadWizard onClose={() => setUploadOpen(false)} />
        ) : (
          <div className="card-surface p-8 flex flex-col items-center text-center gap-5">
            <div className="w-12 h-12 rounded-xl bg-[var(--amber-tint)] border border-[var(--amber)]/40 flex items-center justify-center text-[var(--ink-on-amber)]">
              <FileSpreadsheet className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-page-title text-2xl font-semibold text-[var(--brown)]">
                Hay Recruitment Workforce AI Central
              </h1>
              <p className="text-sm text-[var(--muted)] mt-2 max-w-xl">
                No workforce dataset is loaded yet. Upload your attendance, task, and engagement export to clean records automatically, uncover missed warning signs, and build evidence-based retention plans.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="btn-primary px-5 py-2.5 text-sm inline-flex items-center gap-2"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                Upload workforce file
              </button>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="btn-secondary px-4 py-2.5 text-sm inline-flex items-center gap-2"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                Download blank CSV template
              </button>
              <button
                type="button"
                disabled={demoLoading}
                onClick={async () => {
                  setDemoLoading(true);
                  await loadDemoData();
                  setDemoLoading(false);
                }}
                className="btn-secondary px-4 py-2.5 text-sm inline-flex items-center gap-2"
              >
                <Database className="w-4 h-4" aria-hidden="true" />
                {demoLoading ? 'Generating demo data...' : 'Load demo data (300 synthetic rows)'}
              </button>
            </div>

            <div className="pt-4 border-t border-[var(--border)] w-full max-w-xl">
              <p className="text-xs text-[var(--muted)] mb-2">
                Supported formats (parsed locally in a Web Worker, max 20 MB / 100,000 rows):
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 text-xs text-[var(--brown)]">
                {['.xlsx', '.xls', '.xlsm', '.csv', '.tsv', '.txt', '.json', '.ndjson', '.xml'].map(
                  (fmt) => (
                    <span
                      key={fmt}
                      className="px-2 py-0.5 rounded bg-[var(--cream)] border border-[var(--border)]"
                    >
                      {fmt}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const isEmptySelection = filteredEmployees.length === 0;
  const totalForCharts = Math.max(1, filteredEmployees.length);

  const statusDonutData = [
    { name: 'Present', value: kpis.present.count, itemStyle: { color: STATUS_COLOURS.Present } },
    { name: 'Remote', value: kpis.remote.count, itemStyle: { color: STATUS_COLOURS.Remote } },
    {
      name: 'Leave',
      value: kpis.leave.count,
      itemStyle: { color: STATUS_COLOURS.Leave, decal: createLeaveDecal() },
    },
    { name: 'Absent', value: kpis.absent.count, itemStyle: { color: STATUS_COLOURS.Absent } },
  ].filter((d) => d.value > 0);

  const goToEmployeesWithFilter = (patch: Partial<typeof INITIAL_FILTER_STATE>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    navigate('/employees');
  };

  return (
    <div className="flex flex-col">
      <FilterBar />

      <div className="p-4 lg:p-6 flex flex-col gap-5 max-w-[1600px] w-full mx-auto">
        {uploadOpen && (
          <UploadWizard onClose={() => setUploadOpen(false)} />
        )}

        {/* Header strip */}
        <section className="card-surface p-4 lg:p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-page-title text-2xl font-semibold text-[var(--brown)]">
                Hay Recruitment Workforce AI Central
              </h1>
              {activeSnapshot.isDemo && (
                <span className="px-2.5 py-0.5 rounded bg-[var(--amber-tint)] border border-[var(--amber)] text-xs font-semibold text-[var(--ink-on-amber)]">
                  Demo data
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--muted)] mt-1">
              Source: <strong className="text-[var(--brown)]">{activeSnapshot.fileName}</strong> · Uploaded{' '}
              {formatUkDate(activeSnapshot.uploadedAt.slice(0, 10))} · Latest record{' '}
              {formatUkDate(activeSnapshot.latestLastUpdated)} · Risk mode:{' '}
              <strong className="text-[var(--brown)]">{settings.activeRiskMode.replace('_', ' ')}</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 no-print">
            <button
              type="button"
              onClick={() => navigate('/data')}
              className="btn-secondary px-3 py-2 text-xs inline-flex items-center gap-2"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--olive-text)]" aria-hidden="true" />
              <span>
                Data Quality:{' '}
                <strong className="tabular-nums">
                  {activeSnapshot.dataQualityReport.overallScore}/100
                </strong>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPrivacyMode(!privacyMode)}
              className="btn-secondary px-3 py-2 text-xs inline-flex items-center gap-1.5"
            >
              {privacyMode ? (
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{privacyMode ? 'Names masked' : 'Privacy Mode'}</span>
            </button>

            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="btn-primary px-4 py-2 text-xs inline-flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Upload new data
            </button>
          </div>
        </section>

        {/* Status reconciliation banner */}
        {!kpis.statusReconciles && (
          <div
            role="alert"
            className="rounded-xl border border-[var(--amber)] bg-[var(--amber-tint)] px-4 py-3 text-xs text-[var(--ink-on-amber)] flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                Status counts do not add up to the total,{' '}
                <strong className="tabular-nums">{kpis.unmappedStatusCount}</strong> record(s) have an unrecognised status.
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="font-semibold underline"
            >
              Fix status mapping in Settings
            </button>
          </div>
        )}

        {/* 8 Headline KPI cards */}
        <section aria-label="Headline workforce KPIs" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <KpiCard
            label="Total Employees"
            value={isEmptySelection ? 'No data' : kpis.totalEmployees.toLocaleString()}
            secondaryLine="Unique IDs in view"
            statusAccent="brown"
            formula="Count of unique Employee IDs matching the active filters."
            onClick={() => navigate('/employees')}
          />
          <KpiCard
            label="Present"
            value={isEmptySelection ? 'No data' : kpis.present.count.toLocaleString()}
            secondaryLine={kpis.present.sharePct !== null ? `${kpis.present.sharePct}% of total` : 'No data for selection'}
            statusAccent="olive"
            formula="Count of employees with Work Status normalised to Present."
            onClick={() => goToEmployeesWithFilter({ workStatuses: ['Present'] })}
          />
          <KpiCard
            label="Remote"
            value={isEmptySelection ? 'No data' : kpis.remote.count.toLocaleString()}
            secondaryLine={kpis.remote.sharePct !== null ? `${kpis.remote.sharePct}% of total` : 'No data for selection'}
            statusAccent="amber"
            formula="Count of employees with Work Status normalised to Remote (WFH / Home)."
            onClick={() => goToEmployeesWithFilter({ workStatuses: ['Remote'] })}
          />
          <KpiCard
            label="Leave"
            value={isEmptySelection ? 'No data' : kpis.leave.count.toLocaleString()}
            secondaryLine={kpis.leave.sharePct !== null ? `${kpis.leave.sharePct}% of total` : 'No data for selection'}
            statusAccent="leave"
            formula="Count of employees with Work Status normalised to Leave (Annual / Sick)."
            onClick={() => goToEmployeesWithFilter({ workStatuses: ['Leave'] })}
          />
          <KpiCard
            label="Absent"
            value={isEmptySelection ? 'No data' : kpis.absent.count.toLocaleString()}
            secondaryLine={kpis.absent.sharePct !== null ? `${kpis.absent.sharePct}% of total` : 'No data for selection'}
            statusAccent="sienna"
            formula="Count of employees with Work Status normalised to Absent."
            onClick={() => goToEmployeesWithFilter({ workStatuses: ['Absent'] })}
          />
          <KpiCard
            label="Avg Engagement"
            value={
              kpis.avgEngagementScore !== null
                ? `${kpis.avgEngagementScore}/${kpis.engagementScaleMax}`
                : 'No data'
            }
            secondaryLine={kpis.avgEngagementPct !== null ? `${kpis.avgEngagementPct}% of scale` : 'No data for selection'}
            deltaText={
              kpis.engagementDeltaPct !== null
                ? `${kpis.engagementDeltaPct > 0 ? '+' : ''}${kpis.engagementDeltaPct} pts`
                : undefined
            }
            deltaTone={
              kpis.engagementDeltaPct === null
                ? 'neutral'
                : kpis.engagementDeltaPct >= 0
                ? 'positive'
                : 'negative'
            }
            statusAccent="amber"
            formula="Mean Engagement Score across active selection divided by detected scale maximum."
            onClick={() => navigate('/dashboard')}
          />
          <KpiCard
            label="Needs Attention"
            value={isEmptySelection ? 'No data' : kpis.needsAttention.count.toLocaleString()}
            secondaryLine={
              isEmptySelection
                ? 'No data'
                : `${kpis.needsAttention.sharePct ?? 0}% · +${kpis.needsAttention.additionalSignalCount} missed`
            }
            statusAccent="oxblood"
            formula="Employees flagged Needs Attention in source data, plus computed warning-sign gap."
            onClick={() => goToEmployeesWithFilter({ attentionStatuses: ['Needs Attention'] })}
          />
          <KpiCard
            label="Pending Tasks"
            value={isEmptySelection ? 'No data' : kpis.pendingTasks.toLocaleString()}
            secondaryLine={`${kpis.overdueTasks.toLocaleString()} Overdue tasks`}
            statusAccent="brown"
            formula="Sum of Pending Tasks (open, not yet overdue). Overdue Tasks shown separately."
            onClick={() => navigate('/employees')}
          />
        </section>

        {/* Warning Signs Strip */}
        <section aria-label="Early warning signs summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              label: 'Low engagement',
              count: kpis.warningCounts.lowEngagement,
              desc: `Below ${settings.lowEngagementPct}% of scale`,
              signal: 'low_engagement' as const,
              tone: 'border-[var(--amber)]/50',
            },
            {
              label: 'Heavy workload',
              count: kpis.warningCounts.heavyWorkload,
              desc: `High load, >P${settings.heavyWorkloadPercentile} open, or >=${settings.heavyWorkloadOverduePct}% overdue`,
              signal: 'heavy_workload' as const,
              tone: 'border-[var(--risk-high)]/40',
            },
            {
              label: 'Burnout pattern',
              count: kpis.warningCounts.burnoutPattern,
              desc: 'Heavy workload + low engagement together',
              signal: 'burnout_pattern' as const,
              tone: 'border-[var(--risk-critical)]/45',
            },
            {
              label: 'Missed warning signs',
              count: kpis.warningCounts.missedWarningSigns,
              desc: 'Warning/Critical signal fired while Attention Status is OK',
              signal: 'missed_warning_signs' as const,
              tone: 'border-[var(--risk-critical)] bg-[var(--oxblood-tint)]/35',
            },
          ].map((item) => (
            <button
              key={item.signal}
              type="button"
              onClick={() => goToEmployeesWithFilter({ signalTypes: [item.signal] })}
              className={`card-surface p-3.5 text-left hover:bg-[var(--cream)]/50 transition-colors border ${item.tone}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--brown)]">{item.label}</span>
                <span className="text-xl font-semibold tabular-nums text-[var(--brown)]">
                  {item.count}
                </span>
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-1">{item.desc}</p>
            </button>
          ))}
        </section>

        {/* Three Summary Charts */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard
            title="Work Status Split"
            subtitle={`Employees by current status (n=${filteredEmployees.length})`}
            formulaInfo="Counts of Present, Remote, Leave, and Absent across filtered employees. Click a slice to filter."
            exportSlug="home-work-status"
            summaryText={`Present ${kpis.present.count}, Remote ${kpis.remote.count}, Leave ${kpis.leave.count}, Absent ${kpis.absent.count}.`}
            csvHeaders={['Work Status', 'Employees', 'Share %']}
            csvRows={statusDonutData.map((d) => [
              d.name,
              d.value,
              ((d.value / totalForCharts) * 100).toFixed(1),
            ])}
            onElementClick={({ name }) => {
              if (name === 'Present' || name === 'Remote' || name === 'Leave' || name === 'Absent') {
                toggleFilterValue('workStatuses', name as WorkStatus);
              }
            }}
            option={
              isEmptySelection
                ? null
                : {
                    tooltip: {
                      trigger: 'item',
                      formatter: (p: unknown) => {
                        const item = p as { name: string; value: number; percent: number };
                        return `${item.name}: <strong>${item.value}</strong> employees (${item.percent}%)`;
                      },
                    },
                    legend: { bottom: 0 },
                    series: [
                      {
                        type: 'pie',
                        radius: ['46%', '70%'],
                        center: ['50%', '44%'],
                        data: statusDonutData,
                        label: {
                          formatter: '{b}: {c} ({d}%)',
                          fontSize: 11,
                          color: BRAND_TOKENS.brown,
                        },
                      },
                    ],
                  }
            }
          />

          <ChartCard
            title="Employees by Department"
            subtitle={`Headcount per department (n=${filteredEmployees.length})`}
            formulaInfo="Unique Employee IDs grouped by standardised Department, sorted descending. Click a bar to filter."
            exportSlug="home-dept-headcount"
            summaryText={deptCounts.map((d) => `${d.group}: ${d.count}`).join('; ')}
            csvHeaders={['Department', 'Employees', 'Share %']}
            csvRows={deptCounts.map((d) => [d.group, d.count, d.sharePct ?? 0])}
            onElementClick={({ name }) => toggleFilterValue('departments', name)}
            option={
              isEmptySelection
                ? null
                : {
                    tooltip: {
                      trigger: 'axis',
                      formatter: (params: unknown) => {
                        const arr = params as Array<{ name: string; value: number }>;
                        const first = arr[0];
                        const pct = ((first.value / totalForCharts) * 100).toFixed(1);
                        return `${first.name}: <strong>${first.value}</strong> employees (${pct}%)`;
                      },
                    },
                    grid: { left: 135, right: 32, top: 12, bottom: 28 },
                    xAxis: { type: 'value', name: 'Employees', min: 0, splitLine: HORIZONTAL_GUIDE_SPLITLINE },
                    yAxis: {
                      type: 'category',
                      data: [...deptCounts].reverse().map((d) => d.group),
                    },
                    series: [
                      {
                        type: 'bar',
                        data: [...deptCounts].reverse().map((d) => d.count),
                        itemStyle: { color: BRAND_TOKENS.amber },
                        label: { show: true, position: 'right', color: BRAND_TOKENS.brown },
                      },
                    ],
                  }
            }
          />

          <ChartCard
            title={generateDeptEngagementInsight(filteredEmployees, settings)}
            subtitle={`Average Engagement % vs company mean (${kpis.avgEngagementPct ?? 'n/a'}%)`}
            formulaInfo="Mean Engagement Score as percentage of scale maximum per Department, dashed line marks selection average."
            exportSlug="home-dept-engagement"
            summaryText={deptEngagement.map((d) => `${d.group}: ${d.value}% (n=${d.count})`).join('; ')}
            csvHeaders={['Department', 'Avg Engagement %', 'Employees']}
            csvRows={deptEngagement.map((d) => [d.group, d.value ?? 0, d.count])}
            onElementClick={({ name }) => toggleFilterValue('departments', name)}
            option={
              isEmptySelection
                ? null
                : {
                    tooltip: {
                      trigger: 'axis',
                      formatter: (params: unknown) => {
                        const arr = params as Array<{ name: string; value: number; dataIndex: number }>;
                        const first = arr[0];
                        const row = [...deptEngagement].reverse()[first.dataIndex];
                        return `${first.name}: <strong>${first.value}%</strong> (n=${row?.count ?? 0})`;
                      },
                    },
                    grid: { left: 135, right: 36, top: 18, bottom: 28 },
                    xAxis: { type: 'value', name: '% of scale', min: 0, max: 100 },
                    yAxis: {
                      type: 'category',
                      data: [...deptEngagement].reverse().map((d) => d.group),
                    },
                    series: [
                      {
                        type: 'bar',
                        data: [...deptEngagement].reverse().map((d) => d.value ?? 0),
                        itemStyle: { color: BRAND_TOKENS.olive },
                        label: { show: true, position: 'right', formatter: '{c}%', color: BRAND_TOKENS.brown },
                        markLine:
                          kpis.avgEngagementPct !== null
                            ? {
                                symbol: 'none',
                                lineStyle: { color: BRAND_TOKENS.brown, type: 'dashed' },
                                data: [{ xAxis: kpis.avgEngagementPct, name: 'Avg' }],
                                label: { formatter: `Avg ${kpis.avgEngagementPct}%`, position: 'insideEndTop' },
                              }
                            : undefined,
                      },
                    ],
                  }
            }
          />
        </section>

        {/* Top 10 Needs Attention Panel */}
        <section className="card-surface p-4 lg:p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[var(--brown)]">
                Top 10 Employees Requiring Early Attention
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Ranked by {settings.activeRiskMode.replace('_', ' ')} score across the active selection
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/employees')}
              className="btn-secondary px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
            >
              See all
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {top10AtRisk.length === 0 ? (
            <p className="text-xs text-[var(--muted)] py-6 text-center">
              No employees match these filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--cream)] text-[var(--brown)] text-xs">
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)]">Employee</th>
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)]">Department</th>
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)]">Level</th>
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)]">Risk Score</th>
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)]">Primary Driver</th>
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)] text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/60">
                  {top10AtRisk.map((emp) => (
                    <tr key={emp.employeeId} className="hover:bg-[var(--cream)]/35">
                      <td className="px-3 py-2 font-medium text-[var(--brown)] whitespace-nowrap">
                        {maskEmployeeName(emp.employeeName, emp.employeeId, privacyMode)}
                        {emp.missedByCurrentProcess && (
                          <span className="ml-2 text-[11px] font-semibold text-[var(--risk-critical)]">
                            · Missed by current process
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[var(--brown)] whitespace-nowrap">{emp.department}</td>
                      <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap">{emp.jobLevel}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <RiskBandChip band={emp.riskBand} score={emp.riskScore} />
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)]">
                        {emp.drivers[0]
                          ? `${emp.drivers[0].factor}: ${emp.drivers[0].employeeValue} (peer ${emp.drivers[0].peerMedian})`
                          : 'Composite baseline'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedEmployee(emp)}
                          className="text-xs font-semibold text-[var(--brown)] underline hover:text-[var(--ink-on-amber)]"
                        >
                          View profile
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Changes since last upload (only when previous snapshot exists) */}
        {snapshotDiff && previousSnapshot && (
          <section className="card-surface p-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--brown)]">
                Changes Since Last Upload ({previousSnapshot.fileName})
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Snapshot delta comparing {previousSnapshot.rowCount} prior records to {activeSnapshot.rowCount} current records
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-xs tabular-nums">
              <span>
                Added: <strong className="text-[var(--olive-text)]">+{snapshotDiff.added}</strong>
              </span>
              <span>
                Removed: <strong className="text-[var(--risk-high)]">-{snapshotDiff.removed}</strong>
              </span>
              <span>
                Status changed: <strong className="text-[var(--brown)]">{snapshotDiff.statusChanged}</strong>
              </span>
              <span>
                Engagement shifted: <strong className="text-[var(--brown)]">{snapshotDiff.engagementChanged}</strong>
              </span>
            </div>
          </section>
        )}
      </div>

      <ProfileDrawer
        employee={selectedEmployee}
        orderedList={top10AtRisk}
        onSelectEmployee={setSelectedEmployee}
        onClose={() => setSelectedEmployee(null)}
      />
    </div>
  );
};
