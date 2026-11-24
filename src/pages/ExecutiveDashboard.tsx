import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { FilterBar } from '../components/FilterBar';
import { ChartCard } from '../components/ChartCard';
import { KpiCard } from '../components/KpiCard';
import { ProfileDrawer } from '../components/ProfileDrawer';
import {
  aggregateByGroup,
  computeHeadlineKpis,
  generateDeptEngagementInsight,
  getTopAttentionReasonTags,
  maskEmployeeName,
  TENURE_BAND_ORDER,
} from '../lib/metrics';
import { mean, median } from '../lib/features/signals';
import { BRAND_TOKENS, RISK_BAND_COLOURS, STATUS_COLOURS } from '../theme/tokens';
import { createLeaveDecal, HORIZONTAL_GUIDE_SPLITLINE } from '../theme/echartsTheme';
import type { EmployeeRecord } from '../types/workforce';

type DashboardTab = 'overview' | 'job_level' | 'low_engagement' | 'heavy_workload';

export const ExecutiveDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    allEmployees,
    filteredEmployees,
    activeSnapshot,
    previousSnapshot,
    settings,
    privacyMode,
    clearFilters,
    toggleFilterValue,
  } = useWorkforce();

  const [tab, setTab] = useState<DashboardTab>('overview');
  const [compareTo, setCompareTo] = useState<'company' | 'previous' | string>('company');
  const [fullScreen, setFullScreen] = useState(false);
  const [drawerEmployee, setDrawerEmployee] = useState<EmployeeRecord | null>(null);

  const scaleMax = activeSnapshot?.engagementScaleMax ?? 10;
  const kpis = useMemo(
    () => computeHeadlineKpis(filteredEmployees, scaleMax, previousSnapshot?.employees),
    [filteredEmployees, scaleMax, previousSnapshot]
  );

  const departments = useMemo(
    () => Array.from(new Set(allEmployees.map((e) => e.department))).sort(),
    [allEmployees]
  );

  const referenceEngPct = useMemo(() => {
    if (compareTo === 'previous' && previousSnapshot?.employees.length) {
      return Math.round(mean(previousSnapshot.employees.map((e) => e.engagementPct)) * 10) / 10;
    }
    if (compareTo !== 'company' && compareTo !== 'previous') {
      const deptEmps = allEmployees.filter((e) => e.department === compareTo);
      if (deptEmps.length > 0) {
        return Math.round(mean(deptEmps.map((e) => e.engagementPct)) * 10) / 10;
      }
    }
    return kpis.avgEngagementPct ?? 0;
  }, [compareTo, previousSnapshot, allEmployees, kpis.avgEngagementPct]);

  // Tab 1 data
  const statusByDept = useMemo(() => {
    const depts = Array.from(new Set(filteredEmployees.map((e) => e.department))).sort();
    return depts.map((d) => {
      const list = filteredEmployees.filter((e) => e.department === d);
      return {
        dept: d,
        Present: list.filter((e) => e.workStatus === 'Present').length,
        Remote: list.filter((e) => e.workStatus === 'Remote').length,
        Leave: list.filter((e) => e.workStatus === 'Leave').length,
        Absent: list.filter((e) => e.workStatus === 'Absent').length,
      };
    });
  }, [filteredEmployees]);

  const arrangementByLoc = useMemo(() => {
    const locs = Array.from(new Set(filteredEmployees.map((e) => e.location))).sort();
    return locs.map((l) => {
      const list = filteredEmployees.filter((e) => e.location === l);
      const n = Math.max(1, list.length);
      return {
        loc: l,
        Office: Math.round((list.filter((e) => e.workArrangement === 'Office').length / n) * 100),
        Hybrid: Math.round((list.filter((e) => e.workArrangement === 'Hybrid').length / n) * 100),
        Remote: Math.round((list.filter((e) => e.workArrangement === 'Remote').length / n) * 100),
        n: list.length,
      };
    });
  }, [filteredEmployees]);

  const tenureCounts = useMemo(() => {
    const raw = aggregateByGroup(filteredEmployees, 'count', 'tenureBand', 'count', settings.smallSampleThreshold);
    const map = new Map(raw.map((r) => [r.group, r.count]));
    return TENURE_BAND_ORDER.map((band) => ({ band, count: map.get(band) ?? 0 }));
  }, [filteredEmployees, settings.smallSampleThreshold]);

  const freshnessBuckets = useMemo(() => {
    const b = [
      { label: '0–7 days', count: 0 },
      { label: '8–14 days', count: 0 },
      { label: '15–30 days', count: 0 },
      { label: '31+ days (Stale)', count: 0 },
    ];
    for (const e of filteredEmployees) {
      if (e.daysSinceUpdated <= 7) b[0].count += 1;
      else if (e.daysSinceUpdated <= 14) b[1].count += 1;
      else if (e.daysSinceUpdated <= 30) b[2].count += 1;
      else b[3].count += 1;
    }
    return b;
  }, [filteredEmployees]);

  // Tab 2: Job Level
  const jobLevelsOrdered = useMemo(() => {
    const present = Array.from(new Set(filteredEmployees.map((e) => e.jobLevel)));
    const orderMap = new Map(settings.jobLevelOrder.map((l, i) => [l.toLowerCase(), i]));
    return present.sort(
      (a, b) => (orderMap.get(a.toLowerCase()) ?? 99) - (orderMap.get(b.toLowerCase()) ?? 99)
    );
  }, [filteredEmployees, settings.jobLevelOrder]);

  const levelStats = useMemo(() => {
    const total = Math.max(1, filteredEmployees.length);
    return jobLevelsOrdered.map((lvl) => {
      const list = filteredEmployees.filter((e) => e.jobLevel === lvl);
      const n = list.length;
      const avgEng = n > 0 ? Math.round(mean(list.map((e) => e.engagementPct)) * 10) / 10 : 0;
      const avgOpen = n > 0 ? Math.round(mean(list.map((e) => e.openTasks)) * 10) / 10 : 0;
      const avgOverdue = n > 0 ? Math.round(mean(list.map((e) => e.overdueTasks)) * 10) / 10 : 0;
      const overdueShare = n > 0 ? Math.round(mean(list.map((e) => (e.overdueShare ?? 0) * 100)) * 10) / 10 : 0;
      const attShare = n > 0 ? Math.round((list.filter((e) => e.needsAttentionFlag).length / n) * 1000) / 10 : 0;
      return {
        level: lvl,
        count: n,
        sharePct: Math.round((n / total) * 1000) / 10,
        avgEng,
        lowPct: n > 0 ? Math.round((list.filter((e) => e.workloadLevel === 'Low').length / n) * 100) : 0,
        medPct: n > 0 ? Math.round((list.filter((e) => e.workloadLevel === 'Medium').length / n) * 100) : 0,
        highPct: n > 0 ? Math.round((list.filter((e) => e.workloadLevel === 'High').length / n) * 100) : 0,
        avgOpen,
        avgOverdue,
        overdueShare,
        attShare,
      };
    });
  }, [filteredEmployees, jobLevelsOrdered]);

  const heatmapData = useMemo(() => {
    const depts = Array.from(new Set(filteredEmployees.map((e) => e.department))).sort();
    const cells: Array<{ value: [number, number, number]; count: number; small: boolean }> = [];
    depts.forEach((d, yIdx) => {
      jobLevelsOrdered.forEach((l, xIdx) => {
        const list = filteredEmployees.filter((e) => e.department === d && e.jobLevel === l);
        if (list.length > 0) {
          const avgRisk = Math.round(mean(list.map((e) => e.riskScore)));
          cells.push({
            value: [xIdx, yIdx, avgRisk],
            count: list.length,
            small: list.length < settings.smallSampleThreshold,
          });
        }
      });
    });
    return { depts, cells };
  }, [filteredEmployees, jobLevelsOrdered, settings.smallSampleThreshold]);

  // Tab 3: Low engagement
  const engHistogram = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => ({
      label: `${i * 10}–${(i + 1) * 10}%`,
      count: 0,
    }));
    for (const e of filteredEmployees) {
      const idx = Math.min(9, Math.floor(e.engagementPct / 10));
      bins[idx].count += 1;
    }
    return bins;
  }, [filteredEmployees]);

  const lowEngByDept = useMemo(() => {
    const depts = Array.from(new Set(filteredEmployees.map((e) => e.department)));
    return depts
      .map((d) => {
        const list = filteredEmployees.filter((e) => e.department === d);
        return {
          dept: d,
          below60: list.filter((e) => e.engagementPct < settings.lowEngagementPct).length,
          below40: list.filter((e) => e.engagementPct < settings.criticalEngagementPct).length,
        };
      })
      .sort((a, b) => b.below60 - a.below60);
  }, [filteredEmployees, settings.lowEngagementPct, settings.criticalEngagementPct]);

  const missedLowEng = useMemo(
    () =>
      filteredEmployees
        .filter(
          (e) =>
            e.engagementPct < settings.lowEngagementPct && e.attentionStatus === 'OK'
        )
        .sort((a, b) => a.engagementPct - b.engagementPct)
        .slice(0, 15),
    [filteredEmployees, settings.lowEngagementPct]
  );

  const topReasonTags = useMemo(() => getTopAttentionReasonTags(filteredEmployees, 10), [filteredEmployees]);

  // Tab 4: Heavy workload
  const workloadByDept = useMemo(() => {
    const depts = Array.from(new Set(filteredEmployees.map((e) => e.department))).sort();
    return depts.map((d) => {
      const list = filteredEmployees.filter((e) => e.department === d);
      return {
        dept: d,
        Low: list.filter((e) => e.workloadLevel === 'Low').length,
        Medium: list.filter((e) => e.workloadLevel === 'Medium').length,
        High: list.filter((e) => e.workloadLevel === 'High').length,
      };
    });
  }, [filteredEmployees]);

  const top15OpenTasks = useMemo(() => {
    const peerMedianMap = new Map<string, number>();
    return [...filteredEmployees]
      .sort((a, b) => b.openTasks - a.openTasks)
      .slice(0, 15)
      .map((e) => {
        const key = `${e.department}|||${e.jobLevel}`;
        let pMed = peerMedianMap.get(key);
        if (pMed === undefined) {
          const peers = filteredEmployees.filter(
            (x) => x.department === e.department && x.jobLevel === e.jobLevel
          );
          pMed = Math.round(median((peers.length >= 5 ? peers : filteredEmployees).map((x) => x.openTasks)));
          peerMedianMap.set(key, pMed);
        }
        return {
          emp: e,
          label: maskEmployeeName(e.employeeName, e.employeeId, privacyMode),
          openTasks: e.openTasks,
          peerMedian: pMed,
        };
      });
  }, [filteredEmployees, privacyMode]);

  const overdueByDept = useMemo(
    () =>
      aggregateByGroup(filteredEmployees, 'overdueShare', 'department', 'mean', settings.smallSampleThreshold).sort(
        (a, b) => (b.value ?? 0) - (a.value ?? 0)
      ),
    [filteredEmployees, settings.smallSampleThreshold]
  );

  const missedHeavyWorkload = useMemo(
    () =>
      filteredEmployees
        .filter(
          (e) =>
            e.signals.some((s) => s.code === 'heavy_workload' || s.code === 'severe_overload') &&
            e.attentionStatus === 'OK'
        )
        .sort((a, b) => (b.overdueShare ?? 0) - (a.overdueShare ?? 0))
        .slice(0, 15),
    [filteredEmployees]
  );

  const leaveByDept = useMemo(
    () =>
      aggregateByGroup(
        filteredEmployees,
        'leaveDaysRemaining',
        'department',
        'mean',
        settings.smallSampleThreshold
      ).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [filteredEmployees, settings.smallSampleThreshold]
  );

  // Sample scatter points if > 2000
  const scatterSample = useMemo(() => {
    if (filteredEmployees.length <= 2000) return { list: filteredEmployees, sampled: false };
    const step = Math.ceil(filteredEmployees.length / 2000);
    return {
      list: filteredEmployees.filter((_, i) => i % step === 0).slice(0, 2000),
      sampled: true,
    };
  }, [filteredEmployees]);

  if (allEmployees.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center card-surface mt-8">
        <h1 className="font-page-title text-xl font-semibold text-[var(--brown)]">
          Executive Dashboard
        </h1>
        <p className="text-xs text-[var(--muted)] mt-2 mb-4">
          Upload workforce data or load demo data first to view executive charts.
        </p>
        <button type="button" onClick={() => navigate('/')} className="btn-primary px-4 py-2 text-xs">
          Go to Home
        </button>
      </div>
    );
  }

  const isEmpty = filteredEmployees.length === 0;
  const burnoutCount = kpis.warningCounts.burnoutPattern;

  return (
    <div className={fullScreen ? 'fixed inset-0 z-40 bg-[var(--cream)] overflow-y-auto' : 'flex flex-col'}>
      <FilterBar />

      <div className="p-4 lg:p-6 flex flex-col gap-5 max-w-[1600px] w-full mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-page-title text-2xl font-semibold text-[var(--brown)]">
              Executive Dashboard
            </h1>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {generateDeptEngagementInsight(filteredEmployees, settings)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <label className="text-xs text-[var(--muted)] flex items-center gap-1.5">
              Compare to:
              <select
                value={compareTo}
                onChange={(e) => setCompareTo(e.target.value)}
                className="h-8 px-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--brown)]"
              >
                <option value="company">Selection average</option>
                {previousSnapshot && <option value="previous">Previous snapshot</option>}
                {departments.map((d) => (
                  <option key={d} value={d}>
                    Dept: {d}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                clearFilters();
                setCompareTo('company');
              }}
              className="btn-secondary h-8 px-3 text-xs inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset view
            </button>

            <button
              type="button"
              onClick={() => setFullScreen((v) => !v)}
              className="btn-secondary h-8 px-3 text-xs inline-flex items-center gap-1.5"
            >
              {fullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              {fullScreen ? 'Exit full screen' : 'Present'}
            </button>
          </div>
        </div>

        {/* 4 Tabs */}
        <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-[var(--surface)] border border-[var(--border)] w-fit no-print" role="tablist">
          {[
            { id: 'overview', label: 'Workforce overview' },
            { id: 'job_level', label: 'Job level' },
            { id: 'low_engagement', label: 'Low engagement warning signs' },
            { id: 'heavy_workload', label: 'Heavy workload warning signs' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id as DashboardTab)}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] font-semibold'
                  : 'text-[var(--brown)] hover:bg-[var(--cream)]/60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB 1: WORKFORCE OVERVIEW */}
        {tab === 'overview' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
              <KpiCard label="Total" value={String(kpis.totalEmployees)} statusAccent="brown" formula="Count of unique Employee IDs" />
              <KpiCard label="Present" value={String(kpis.present.count)} secondaryLine={`${kpis.present.sharePct ?? 0}%`} statusAccent="olive" formula="Work Status = Present" />
              <KpiCard label="Remote" value={String(kpis.remote.count)} secondaryLine={`${kpis.remote.sharePct ?? 0}%`} statusAccent="amber" formula="Work Status = Remote" />
              <KpiCard label="Leave" value={String(kpis.leave.count)} secondaryLine={`${kpis.leave.sharePct ?? 0}%`} statusAccent="leave" formula="Work Status = Leave" />
              <KpiCard label="Absent" value={String(kpis.absent.count)} secondaryLine={`${kpis.absent.sharePct ?? 0}%`} statusAccent="sienna" formula="Work Status = Absent" />
              <KpiCard label="Avg Engagement" value={kpis.avgEngagementPct !== null ? `${kpis.avgEngagementPct}%` : 'n/a'} statusAccent="amber" formula="Mean engagement percentage" />
              <KpiCard label="Needs Attention" value={String(kpis.needsAttention.count)} secondaryLine={`+${kpis.warningCounts.missedWarningSigns} missed`} statusAccent="oxblood" formula="Attention Status = Needs Attention" />
              <KpiCard label="Pending Tasks" value={String(kpis.pendingTasks)} secondaryLine={`${kpis.overdueTasks} overdue`} statusAccent="brown" formula="Sum of Pending Tasks" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard
                title="Work Status by Department"
                subtitle={`Stacked employee counts across ${statusByDept.length} departments`}
                exportSlug="dash-status-dept"
                summaryText="Work status breakdown per department."
                csvHeaders={['Department', 'Present', 'Remote', 'Leave', 'Absent']}
                csvRows={statusByDept.map((r) => [r.dept, r.Present, r.Remote, r.Leave, r.Absent])}
                onElementClick={({ name }) => toggleFilterValue('departments', name)}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                        legend: { bottom: 0 },
                        grid: { left: 135, right: 24, top: 14, bottom: 40 },
                        xAxis: { type: 'value', name: 'Employees', splitLine: HORIZONTAL_GUIDE_SPLITLINE },
                        yAxis: { type: 'category', data: statusByDept.map((r) => r.dept) },
                        series: [
                          { name: 'Present', type: 'bar', stack: 's', data: statusByDept.map((r) => r.Present), itemStyle: { color: STATUS_COLOURS.Present } },
                          { name: 'Remote', type: 'bar', stack: 's', data: statusByDept.map((r) => r.Remote), itemStyle: { color: STATUS_COLOURS.Remote } },
                          { name: 'Leave', type: 'bar', stack: 's', data: statusByDept.map((r) => r.Leave), itemStyle: { color: STATUS_COLOURS.Leave, decal: createLeaveDecal() } },
                          { name: 'Absent', type: 'bar', stack: 's', data: statusByDept.map((r) => r.Absent), itemStyle: { color: STATUS_COLOURS.Absent } },
                        ],
                      }
                }
              />

              <ChartCard
                title="Work Arrangement Mix by UK Location"
                subtitle="100% stacked share of Office, Hybrid, and Remote arrangements"
                exportSlug="dash-arrangement-location"
                summaryText="Hybrid, Office, and Remote mix by UK location."
                csvHeaders={['Location', 'Office %', 'Hybrid %', 'Remote %', 'Headcount']}
                csvRows={arrangementByLoc.map((r) => [r.loc, r.Office, r.Hybrid, r.Remote, r.n])}
                onElementClick={({ name }) => toggleFilterValue('locations', name)}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                        legend: { bottom: 0 },
                        grid: { left: 105, right: 24, top: 14, bottom: 40 },
                        xAxis: { type: 'value', max: 100, name: '% of location' },
                        yAxis: { type: 'category', data: arrangementByLoc.map((r) => r.loc) },
                        series: [
                          { name: 'Office', type: 'bar', stack: 'a', data: arrangementByLoc.map((r) => r.Office), itemStyle: { color: BRAND_TOKENS.olive } },
                          { name: 'Hybrid', type: 'bar', stack: 'a', data: arrangementByLoc.map((r) => r.Hybrid), itemStyle: { color: BRAND_TOKENS.amber } },
                          { name: 'Remote', type: 'bar', stack: 'a', data: arrangementByLoc.map((r) => r.Remote), itemStyle: { color: BRAND_TOKENS.brown } },
                        ],
                      }
                }
              />

              <ChartCard
                title="Hiring & Tenure Profile"
                subtitle="Employees grouped by length of service at latest record date"
                exportSlug="dash-tenure-profile"
                summaryText={tenureCounts.map((t) => `${t.band}: ${t.count}`).join('; ')}
                csvHeaders={['Tenure Band', 'Employees']}
                csvRows={tenureCounts.map((t) => [t.band, t.count])}
                onElementClick={({ name }) => toggleFilterValue('tenureBands', name)}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis' },
                        grid: { left: 48, right: 24, top: 20, bottom: 42 },
                        xAxis: { type: 'category', data: tenureCounts.map((t) => t.band), axisLabel: { interval: 0, fontSize: 11 } },
                        yAxis: { type: 'value', name: 'Employees' },
                        series: [
                          {
                            type: 'bar',
                            data: tenureCounts.map((t) => t.count),
                            itemStyle: { color: BRAND_TOKENS.amber },
                            label: { show: true, position: 'top', color: BRAND_TOKENS.brown },
                          },
                        ],
                      }
                }
              />

              <ChartCard
                title="Data Freshness Distribution"
                subtitle={`Days since Last Updated (Stale threshold > ${settings.staleDaysThreshold} days)`}
                exportSlug="dash-data-freshness"
                summaryText={freshnessBuckets.map((b) => `${b.label}: ${b.count}`).join('; ')}
                csvHeaders={['Freshness Bucket', 'Employees']}
                csvRows={freshnessBuckets.map((b) => [b.label, b.count])}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis' },
                        grid: { left: 48, right: 24, top: 20, bottom: 36 },
                        xAxis: { type: 'category', data: freshnessBuckets.map((b) => b.label) },
                        yAxis: { type: 'value', name: 'Employees' },
                        series: [
                          {
                            type: 'bar',
                            data: freshnessBuckets.map((b, i) => ({
                              value: b.count,
                              itemStyle: { color: i === 3 ? BRAND_TOKENS.riskHigh : BRAND_TOKENS.olive },
                            })),
                            label: { show: true, position: 'top', color: BRAND_TOKENS.brown },
                          },
                        ],
                      }
                }
              />
            </div>
          </div>
        )}

        {/* TAB 2: JOB LEVEL */}
        {tab === 'job_level' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(() => {
                const valid = levelStats.filter((l) => l.count > 0);
                const lowestEng = [...valid].sort((a, b) => a.avgEng - b.avgEng)[0];
                const highestOverdue = [...valid].sort((a, b) => b.overdueShare - a.overdueShare)[0];
                const highestAtt = [...valid].sort((a, b) => b.attShare - a.attShare)[0];
                return (
                  <>
                    <div className="card-surface p-3.5">
                      <p className="text-xs text-[var(--muted)]">Lowest Engagement Level</p>
                      <p className="text-base font-semibold text-[var(--brown)] mt-0.5">
                        {lowestEng ? `${lowestEng.level} (${lowestEng.avgEng}%)` : 'n/a'}
                      </p>
                    </div>
                    <div className="card-surface p-3.5">
                      <p className="text-xs text-[var(--muted)]">Highest Overdue Share</p>
                      <p className="text-base font-semibold text-[var(--brown)] mt-0.5">
                        {highestOverdue ? `${highestOverdue.level} (${highestOverdue.overdueShare}%)` : 'n/a'}
                      </p>
                    </div>
                    <div className="card-surface p-3.5">
                      <p className="text-xs text-[var(--muted)]">Highest Needs Attention Rate</p>
                      <p className="text-base font-semibold text-[var(--brown)] mt-0.5">
                        {highestAtt ? `${highestAtt.level} (${highestAtt.attShare}%)` : 'n/a'}
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard
                title="Employees by Job Level"
                subtitle="Ordered by seniority rank with percentage share"
                exportSlug="dash-level-headcount"
                summaryText={levelStats.map((l) => `${l.level}: ${l.count} (${l.sharePct}%)`).join('; ')}
                csvHeaders={['Job Level', 'Employees', 'Share %']}
                csvRows={levelStats.map((l) => [l.level, l.count, l.sharePct])}
                onElementClick={({ name }) => toggleFilterValue('jobLevels', name)}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis' },
                        grid: { left: 48, right: 20, top: 20, bottom: 42 },
                        xAxis: { type: 'category', data: levelStats.map((l) => l.level), axisLabel: { interval: 0, fontSize: 11 } },
                        yAxis: { type: 'value', name: 'Employees' },
                        series: [
                          {
                            type: 'bar',
                            data: levelStats.map((l) => l.count),
                            itemStyle: { color: BRAND_TOKENS.amber },
                            label: {
                              show: true,
                              position: 'top',
                              color: BRAND_TOKENS.brown,
                              formatter: (p: unknown) => {
                                const idx = (p as { dataIndex: number }).dataIndex;
                                return `${levelStats[idx].count} (${levelStats[idx].sharePct}%)`;
                              },
                            },
                          },
                        ],
                      }
                }
              />

              <ChartCard
                title="Average Engagement by Job Level"
                subtitle={`Dashed reference: ${compareTo === 'company' ? 'Selection average' : compareTo} (${referenceEngPct}%)`}
                exportSlug="dash-level-engagement"
                summaryText={levelStats.map((l) => `${l.level}: ${l.avgEng}%`).join('; ')}
                csvHeaders={['Job Level', 'Avg Engagement %', 'Headcount']}
                csvRows={levelStats.map((l) => [l.level, l.avgEng, l.count])}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis' },
                        grid: { left: 48, right: 24, top: 20, bottom: 42 },
                        xAxis: { type: 'category', data: levelStats.map((l) => l.level), axisLabel: { interval: 0, fontSize: 11 } },
                        yAxis: { type: 'value', name: '% of scale', min: 0, max: 100 },
                        series: [
                          {
                            type: 'bar',
                            data: levelStats.map((l) => l.avgEng),
                            itemStyle: { color: BRAND_TOKENS.olive },
                            label: { show: true, position: 'top', formatter: '{c}%', color: BRAND_TOKENS.brown },
                            markLine: {
                              symbol: 'none',
                              lineStyle: { color: BRAND_TOKENS.brown, type: 'dashed' },
                              data: [{ yAxis: referenceEngPct }],
                              label: { formatter: `Ref ${referenceEngPct}%` },
                            },
                          },
                        ],
                      }
                }
              />

              <ChartCard
                title="Department × Job Level Average Risk Score Heatmap"
                subtitle={`Darker amber/sienna indicates higher risk; cells with < ${settings.smallSampleThreshold} employees marked * (small sample)`}
                exportSlug="dash-dept-level-heatmap"
                height={320}
                summaryText="Heatmap of average retention risk score across Department and Job Level."
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: {
                          position: 'top',
                          formatter: (p: unknown) => {
                            const item = p as { data: { value: [number, number, number]; count: number; small: boolean } };
                            const [x, y, risk] = item.data.value;
                            return `${heatmapData.depts[y]} · ${jobLevelsOrdered[x]}<br/>Avg Risk: <strong>${risk}</strong> (n=${item.data.count}${item.data.small ? ', small sample' : ''})`;
                          },
                        },
                        grid: { left: 135, right: 65, top: 12, bottom: 45 },
                        xAxis: { type: 'category', data: jobLevelsOrdered, axisLabel: { interval: 0, fontSize: 11 } },
                        yAxis: { type: 'category', data: heatmapData.depts },
                        visualMap: {
                          min: 0,
                          max: 100,
                          calculable: true,
                          orient: 'vertical',
                          right: 0,
                          top: 'middle',
                          inRange: { color: [BRAND_TOKENS.cream, BRAND_TOKENS.amber, BRAND_TOKENS.riskHigh, BRAND_TOKENS.riskCritical] },
                        },
                        series: [
                          {
                            type: 'heatmap',
                            data: heatmapData.cells,
                            label: {
                              show: true,
                              color: BRAND_TOKENS.brown,
                              formatter: (p: unknown) => {
                                const d = (p as { data: { count: number; small: boolean } }).data;
                                return `n=${d.count}${d.small ? '*' : ''}`;
                              },
                            },
                          },
                        ],
                      }
                }
              />

              <ChartCard
                title="Workload Level Mix & Open/Overdue Tasks by Job Level"
                subtitle="100% stacked workload classification per seniority level"
                exportSlug="dash-level-workload"
                summaryText="Workload level distribution across job levels."
                csvHeaders={['Job Level', 'Low %', 'Medium %', 'High %', 'Avg Open Tasks', 'Avg Overdue Tasks']}
                csvRows={levelStats.map((l) => [l.level, l.lowPct, l.medPct, l.highPct, l.avgOpen, l.avgOverdue])}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                        legend: { bottom: 0 },
                        grid: { left: 48, right: 24, top: 16, bottom: 52 },
                        xAxis: { type: 'category', data: levelStats.map((l) => l.level), axisLabel: { interval: 0, fontSize: 11 } },
                        yAxis: { type: 'value', max: 100, name: '% of level' },
                        series: [
                          { name: 'Low', type: 'bar', stack: 'w', data: levelStats.map((l) => l.lowPct), itemStyle: { color: BRAND_TOKENS.olive } },
                          { name: 'Medium', type: 'bar', stack: 'w', data: levelStats.map((l) => l.medPct), itemStyle: { color: BRAND_TOKENS.amber } },
                          { name: 'High', type: 'bar', stack: 'w', data: levelStats.map((l) => l.highPct), itemStyle: { color: BRAND_TOKENS.riskHigh } },
                        ],
                      }
                }
              />
            </div>
          </div>
        )}

        {/* TAB 3: LOW ENGAGEMENT */}
        {tab === 'low_engagement' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard
                title="Engagement Score Distribution"
                subtitle={`Vertical thresholds at ${settings.criticalEngagementPct}% (Critical) and ${settings.lowEngagementPct}% (Warning)`}
                exportSlug="dash-eng-histogram"
                summaryText={engHistogram.map((b) => `${b.label}: ${b.count}`).join('; ')}
                csvHeaders={['Engagement Band', 'Employees']}
                csvRows={engHistogram.map((b) => [b.label, b.count])}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis' },
                        grid: { left: 48, right: 24, top: 20, bottom: 38 },
                        xAxis: { type: 'category', data: engHistogram.map((b) => b.label), axisLabel: { interval: 0, fontSize: 10 } },
                        yAxis: { type: 'value', name: 'Employees' },
                        series: [
                          {
                            type: 'bar',
                            data: engHistogram.map((b, i) => ({
                              value: b.count,
                              itemStyle: {
                                color:
                                  i * 10 < settings.criticalEngagementPct
                                    ? BRAND_TOKENS.riskCritical
                                    : i * 10 < settings.lowEngagementPct
                                    ? BRAND_TOKENS.riskHigh
                                    : BRAND_TOKENS.amber,
                              },
                            })),
                            label: { show: true, position: 'top', color: BRAND_TOKENS.brown },
                          },
                        ],
                      }
                }
              />

              <ChartCard
                title="Low & Critical Engagement Count by Department"
                subtitle={`Employees below ${settings.lowEngagementPct}% and ${settings.criticalEngagementPct}% thresholds`}
                exportSlug="dash-low-eng-dept"
                summaryText={lowEngByDept.map((d) => `${d.dept}: ${d.below60} low`).join('; ')}
                csvHeaders={['Department', 'Below Warning %', 'Below Critical %']}
                csvRows={lowEngByDept.map((d) => [d.dept, d.below60, d.below40])}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis' },
                        legend: { bottom: 0 },
                        grid: { left: 135, right: 24, top: 16, bottom: 40 },
                        xAxis: { type: 'value', name: 'Employees', splitLine: HORIZONTAL_GUIDE_SPLITLINE },
                        yAxis: { type: 'category', data: [...lowEngByDept].reverse().map((d) => d.dept) },
                        series: [
                          { name: `Below ${settings.lowEngagementPct}%`, type: 'bar', data: [...lowEngByDept].reverse().map((d) => d.below60), itemStyle: { color: BRAND_TOKENS.amber } },
                          { name: `Below ${settings.criticalEngagementPct}%`, type: 'bar', data: [...lowEngByDept].reverse().map((d) => d.below40), itemStyle: { color: BRAND_TOKENS.riskCritical } },
                        ],
                      }
                }
              />

              <ChartCard
                title="Engagement vs Overdue Share (Click point to open profile)"
                subtitle={
                  scatterSample.sampled
                    ? `Sampled 2,000 of ${filteredEmployees.length} employees; size reflects tenure`
                    : `All ${scatterSample.list.length} employees; size reflects tenure, colour reflects Risk Band`
                }
                exportSlug="dash-eng-vs-overdue"
                summaryText="Scatter plot of Engagement percentage vs Overdue task share."
                onElementClick={({ data }) => {
                  const emp = (data as { emp?: EmployeeRecord })?.emp;
                  if (emp) setDrawerEmployee(emp);
                }}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: {
                          formatter: (p: unknown) => {
                            const emp = (p as { data: { emp: EmployeeRecord } }).data.emp;
                            return `${maskEmployeeName(emp.employeeName, emp.employeeId, privacyMode)} (${emp.department})<br/>Engagement: <strong>${Math.round(emp.engagementPct)}%</strong> · Overdue: <strong>${Math.round((emp.overdueShare ?? 0) * 100)}%</strong> · Risk: <strong>${emp.riskScore}</strong>`;
                          },
                        },
                        grid: { left: 52, right: 24, top: 20, bottom: 38 },
                        xAxis: { type: 'value', name: 'Engagement %', min: 0, max: 100, splitLine: HORIZONTAL_GUIDE_SPLITLINE },
                        yAxis: { type: 'value', name: 'Overdue share %', min: 0, max: 100, splitLine: HORIZONTAL_GUIDE_SPLITLINE },
                        series: [
                          {
                            type: 'scatter',
                            data: scatterSample.list.map((e) => ({
                              value: [
                                Math.round(e.engagementPct),
                                Math.round((e.overdueShare ?? 0) * 100),
                              ],
                              symbolSize: Math.max(7, Math.min(20, 6 + e.tenureMonths / 6)),
                              itemStyle: { color: RISK_BAND_COLOURS[e.riskBand], opacity: 0.8 },
                              emp: e,
                            })),
                          },
                        ],
                      }
                }
              />

              <ChartCard
                title="Top Attention Reason Tags"
                subtitle="Recurring free-text reasons from Attention Reason column"
                exportSlug="dash-attention-tags"
                summaryText={topReasonTags.map((t) => `${t.tag}: ${t.count}`).join('; ')}
                csvHeaders={['Reason Tag', 'Count', 'Mapped Signal']}
                csvRows={topReasonTags.map((t) => [t.tag, t.count, t.mappedSignal ?? 'None'])}
                option={
                  topReasonTags.length === 0
                    ? null
                    : {
                        tooltip: { trigger: 'axis' },
                        grid: { left: 155, right: 32, top: 14, bottom: 26 },
                        xAxis: { type: 'value', name: 'Count' },
                        yAxis: { type: 'category', data: [...topReasonTags].reverse().map((t) => t.tag) },
                        series: [
                          {
                            type: 'bar',
                            data: [...topReasonTags].reverse().map((t) => t.count),
                            itemStyle: { color: BRAND_TOKENS.brown },
                            label: { show: true, position: 'right', color: BRAND_TOKENS.brown },
                          },
                        ],
                      }
                }
              />
            </div>

            {/* Missed Low Engagement Table */}
            <div className="card-surface p-4">
              <h3 className="text-sm font-semibold text-[var(--brown)] mb-1">
                Lowest Engagement and Not Yet Flagged (Missed by Current Process)
              </h3>
              <p className="text-xs text-[var(--muted)] mb-3">
                Employees scoring below {settings.lowEngagementPct}% engagement whose source Attention Status is OK
              </p>
              {missedLowEng.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">No missed low-engagement employees in this view.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-[var(--cream)] text-[var(--brown)]">
                        <th className="px-3 py-2 border-b border-[var(--border)]">Employee</th>
                        <th className="px-3 py-2 border-b border-[var(--border)]">Department</th>
                        <th className="px-3 py-2 border-b border-[var(--border)]">Engagement</th>
                        <th className="px-3 py-2 border-b border-[var(--border)]">Risk Score</th>
                        <th className="px-3 py-2 border-b border-[var(--border)] text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]/60">
                      {missedLowEng.map((e) => (
                        <tr key={e.employeeId}>
                          <td className="px-3 py-2 font-medium">{maskEmployeeName(e.employeeName, e.employeeId, privacyMode)}</td>
                          <td className="px-3 py-2">{e.department}</td>
                          <td className="px-3 py-2 tabular-nums text-[var(--risk-critical)] font-semibold">{Math.round(e.engagementPct)}%</td>
                          <td className="px-3 py-2 tabular-nums">{e.riskScore} ({e.riskBand})</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => navigate(`/recommendations?scopeType=employee&scopeId=${encodeURIComponent(e.employeeId)}`)}
                              className="font-semibold underline text-[var(--brown)]"
                            >
                              Generate plan
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: HEAVY WORKLOAD */}
        {tab === 'heavy_workload' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard
                title="Workload Level Mix by Department"
                subtitle="Stacked Low, Medium, and High workload counts"
                exportSlug="dash-workload-dept"
                summaryText="Workload level mix across departments."
                csvHeaders={['Department', 'Low', 'Medium', 'High']}
                csvRows={workloadByDept.map((d) => [d.dept, d.Low, d.Medium, d.High])}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                        legend: { bottom: 0 },
                        grid: { left: 135, right: 24, top: 14, bottom: 40 },
                        xAxis: { type: 'value', name: 'Employees' },
                        yAxis: { type: 'category', data: workloadByDept.map((d) => d.dept) },
                        series: [
                          { name: 'Low', type: 'bar', stack: 'wl', data: workloadByDept.map((d) => d.Low), itemStyle: { color: BRAND_TOKENS.olive } },
                          { name: 'Medium', type: 'bar', stack: 'wl', data: workloadByDept.map((d) => d.Medium), itemStyle: { color: BRAND_TOKENS.amber } },
                          { name: 'High', type: 'bar', stack: 'wl', data: workloadByDept.map((d) => d.High), itemStyle: { color: BRAND_TOKENS.riskHigh } },
                        ],
                      }
                }
              />

              <ChartCard
                title="Top 15 Open Tasks vs Peer Median"
                subtitle="Bars show employee open tasks; brown markers show Dept + Level peer median"
                exportSlug="dash-top15-open-tasks"
                summaryText="Top 15 employees by open tasks compared with peer medians."
                csvHeaders={['Employee', 'Open Tasks', 'Peer Median']}
                csvRows={top15OpenTasks.map((r) => [r.label, r.openTasks, r.peerMedian])}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis' },
                        legend: { bottom: 0 },
                        grid: { left: 145, right: 28, top: 12, bottom: 38 },
                        xAxis: { type: 'value', name: 'Open tasks' },
                        yAxis: { type: 'category', data: [...top15OpenTasks].reverse().map((r) => r.label) },
                        series: [
                          {
                            name: 'Employee Open Tasks',
                            type: 'bar',
                            data: [...top15OpenTasks].reverse().map((r) => r.openTasks),
                            itemStyle: { color: BRAND_TOKENS.amber },
                          },
                          {
                            name: 'Peer Median',
                            type: 'scatter',
                            symbol: 'diamond',
                            symbolSize: 10,
                            data: [...top15OpenTasks].reverse().map((r) => r.peerMedian),
                            itemStyle: { color: BRAND_TOKENS.brown },
                          },
                        ],
                      }
                }
              />

              <ChartCard
                title={`Workload Pressure vs Engagement — Burnout Quadrant (${burnoutCount} employees)`}
                subtitle="Shaded sienna quadrant marks Burnout risk (Workload Pressure >= 55 & Engagement < 60%)"
                exportSlug="dash-burnout-quadrant"
                summaryText={`Scatter of Workload Pressure vs Engagement with ${burnoutCount} employees in burnout risk.`}
                onElementClick={({ data }) => {
                  const emp = (data as { emp?: EmployeeRecord })?.emp;
                  if (emp) setDrawerEmployee(emp);
                }}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: {
                          formatter: (p: unknown) => {
                            const emp = (p as { data: { emp: EmployeeRecord } }).data.emp;
                            return `${maskEmployeeName(emp.employeeName, emp.employeeId, privacyMode)}<br/>Workload Pressure: <strong>${emp.workloadPressure}</strong> · Engagement: <strong>${Math.round(emp.engagementPct)}%</strong>`;
                          },
                        },
                        grid: { left: 52, right: 24, top: 20, bottom: 38 },
                        xAxis: { type: 'value', name: 'Engagement %', min: 0, max: 100 },
                        yAxis: { type: 'value', name: 'Workload Pressure', min: 0, max: 100 },
                        series: [
                          {
                            type: 'scatter',
                            data: scatterSample.list.map((e) => ({
                              value: [Math.round(e.engagementPct), e.workloadPressure],
                              itemStyle: { color: RISK_BAND_COLOURS[e.riskBand], opacity: 0.78 },
                              emp: e,
                            })),
                            markArea: {
                              silent: true,
                              itemStyle: { color: 'rgba(168, 72, 42, 0.12)' },
                              label: {
                                show: true,
                                position: 'insideTopLeft',
                                formatter: `Burnout risk (${burnoutCount})`,
                                color: BRAND_TOKENS.riskCritical,
                                fontSize: 11,
                              },
                              data: [
                                [{ xAxis: 0, yAxis: 55 }, { xAxis: settings.lowEngagementPct, yAxis: 100 }],
                              ],
                            },
                          },
                        ],
                      }
                }
              />

              <ChartCard
                title="Overdue Task Share & Unused Leave by Department"
                subtitle="Average overdue task percentage and average unused leave days remaining"
                exportSlug="dash-overdue-leave-dept"
                summaryText="Overdue share and unused leave days by department."
                csvHeaders={['Department', 'Avg Overdue Share %']}
                csvRows={overdueByDept.map((d) => [d.group, d.value ?? 0])}
                option={
                  isEmpty
                    ? null
                    : {
                        tooltip: { trigger: 'axis' },
                        legend: { bottom: 0 },
                        grid: { left: 135, right: 28, top: 14, bottom: 40 },
                        xAxis: { type: 'value' },
                        yAxis: { type: 'category', data: [...overdueByDept].reverse().map((d) => d.group) },
                        series: [
                          {
                            name: 'Avg Overdue Share %',
                            type: 'bar',
                            data: [...overdueByDept].reverse().map((d) => d.value ?? 0),
                            itemStyle: { color: BRAND_TOKENS.riskHigh },
                          },
                          {
                            name: 'Avg Leave Days Remaining',
                            type: 'bar',
                            data: [...overdueByDept].reverse().map(
                              (d) => leaveByDept.find((l) => l.group === d.group)?.value ?? 0
                            ),
                            itemStyle: { color: BRAND_TOKENS.olive },
                          },
                        ],
                      }
                }
              />
            </div>

            <div className="card-surface p-4">
              <h3 className="text-sm font-semibold text-[var(--brown)] mb-1">
                Heavy Workload and Not Yet Flagged (Missed Warning Signs)
              </h3>
              <p className="text-xs text-[var(--muted)] mb-3">
                Employees triggering Heavy Workload or Severe Overload signals whose Attention Status is OK
              </p>
              {missedHeavyWorkload.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">No missed heavy-workload employees in this view.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-[var(--cream)] text-[var(--brown)]">
                        <th className="px-3 py-2 border-b border-[var(--border)]">Employee</th>
                        <th className="px-3 py-2 border-b border-[var(--border)]">Department</th>
                        <th className="px-3 py-2 border-b border-[var(--border)]">Open / Overdue</th>
                        <th className="px-3 py-2 border-b border-[var(--border)]">Overdue Share</th>
                        <th className="px-3 py-2 border-b border-[var(--border)] text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]/60">
                      {missedHeavyWorkload.map((e) => (
                        <tr key={e.employeeId}>
                          <td className="px-3 py-2 font-medium">{maskEmployeeName(e.employeeName, e.employeeId, privacyMode)}</td>
                          <td className="px-3 py-2">{e.department}</td>
                          <td className="px-3 py-2 tabular-nums">{e.openTasks} / {e.overdueTasks}</td>
                          <td className="px-3 py-2 tabular-nums text-[var(--risk-high)] font-semibold">
                            {e.overdueShare !== null ? `${Math.round(e.overdueShare * 100)}%` : 'n/a'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => navigate(`/recommendations?scopeType=employee&scopeId=${encodeURIComponent(e.employeeId)}`)}
                              className="font-semibold underline text-[var(--brown)]"
                            >
                              Generate plan
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ProfileDrawer
        employee={drawerEmployee}
        orderedList={filteredEmployees}
        onSelectEmployee={setDrawerEmployee}
        onClose={() => setDrawerEmployee(null)}
      />
    </div>
  );
};
