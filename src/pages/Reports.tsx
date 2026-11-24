import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as echarts from 'echarts';
import { CalendarClock, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { FilterBar } from '../components/FilterBar';
import {
  exportAtRiskList,
  exportDataQualityReport,
  exportDepartmentDeepDivePdf,
  exportEmployeeDetails,
  exportExecutiveSummaryPdf,
  exportModelReportPdf,
  exportRetentionPlanPdf,
} from '../lib/reports/exports';
import { aggregateByGroup, maskEmployeeName } from '../lib/metrics';
import { buildEvidencePack, buildPlaybookFallbackPlan } from '../lib/ai/recommendations';
import { registerHayEChartsTheme } from '../theme/echartsTheme';
import { BRAND_TOKENS } from '../theme/tokens';

registerHayEChartsTheme();

export const ReportsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    allEmployees,
    filteredEmployees,
    activeSnapshot,
    previousSnapshot,
    settings,
    privacyMode,
    filters,
    activeModel,
    models,
    recommendations,
    pushToast,
  } = useWorkforce();

  const departments = useMemo(
    () => Array.from(new Set(allEmployees.map((e) => e.department))).sort(),
    [allEmployees]
  );

  const [selectedDept, setSelectedDept] = useState(departments[0] ?? '');
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);

  const effectiveDept = departments.includes(selectedDept) ? selectedDept : departments[0] ?? '';
  const effectiveEmpId =
    allEmployees.some((e) => e.employeeId === selectedEmpId)
      ? selectedEmpId
      : [...allEmployees].sort((a, b) => b.riskScore - a.riskScore)[0]?.employeeId ?? '';

  if (!activeSnapshot || allEmployees.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center card-surface mt-8">
        <h1 className="font-page-title text-xl font-semibold text-[var(--brown)]">
          Reports & Downloads
        </h1>
        <p className="text-xs text-[var(--muted)] mt-2 mb-4">
          Upload workforce data or load demo data first to generate PDF, XLSX, and CSV reports.
        </p>
        <button type="button" onClick={() => navigate('/')} className="btn-primary px-4 py-2 text-xs">
          Go to Home
        </button>
      </div>
    );
  }

  const runDownload = (key: string, fn: () => void, label: string) => {
    setGeneratingKey(key);
    try {
      fn();
      pushToast(`Downloaded ${label}.`, 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : `Failed to generate ${label}.`, 'error');
    } finally {
      setGeneratingKey(null);
    }
  };

  const uploadDate = activeSnapshot.uploadedAt.slice(0, 10);

  const buildExecutiveChartImages = (): Array<{ title: string; dataUrl: string }> => {
    const out: Array<{ title: string; dataUrl: string }> = [];
    const renderOffscreen = (title: string, option: echarts.EChartsOption) => {
      const host = document.createElement('div');
      host.style.width = '760px';
      host.style.height = '280px';
      host.style.position = 'fixed';
      host.style.left = '-9999px';
      host.style.top = '-9999px';
      document.body.appendChild(host);
      try {
        const inst = echarts.init(host, 'hay-workforce');
        inst.setOption({ animation: false, ...option });
        const dataUrl = inst.getDataURL({
          type: 'png',
          pixelRatio: 2,
          backgroundColor: BRAND_TOKENS.surface,
        });
        inst.dispose();
        if (dataUrl) out.push({ title, dataUrl });
      } finally {
        host.remove();
      }
    };

    const deptAgg = aggregateByGroup(
      filteredEmployees,
      'engagementPct',
      'department',
      'mean',
      settings.smallSampleThreshold
    ).sort((a, b) => (a.value ?? 0) - (b.value ?? 0));

    if (deptAgg.length > 0) {
      renderOffscreen('Average Engagement % by Department', {
        grid: { left: 130, right: 32, top: 14, bottom: 26 },
        xAxis: { type: 'value', min: 0, max: 100 },
        yAxis: { type: 'category', data: deptAgg.map((d) => d.group) },
        series: [
          {
            type: 'bar',
            data: deptAgg.map((d) => d.value ?? 0),
            itemStyle: { color: BRAND_TOKENS.amber },
            label: { show: true, position: 'right', formatter: '{c}%' },
          },
        ],
      });
    }

    const bands = (['Low', 'Medium', 'High', 'Critical'] as const).map((band) => ({
      band,
      count: filteredEmployees.filter((e) => e.riskBand === band).length,
    }));
    const bandColors: Record<string, string> = {
      Low: BRAND_TOKENS.olive,
      Medium: BRAND_TOKENS.amber,
      High: BRAND_TOKENS.riskHigh,
      Critical: BRAND_TOKENS.riskCritical,
    };
    renderOffscreen('Workforce Distribution by Risk Band', {
      grid: { left: 50, right: 24, top: 18, bottom: 30 },
      xAxis: { type: 'category', data: bands.map((b) => b.band) },
      yAxis: { type: 'value' },
      series: [
        {
          type: 'bar',
          data: bands.map((b) => ({ value: b.count, itemStyle: { color: bandColors[b.band] } })),
          label: { show: true, position: 'top' },
        },
      ],
    });

    return out;
  };

  return (
    <div className="flex flex-col">
      <FilterBar />

      <div className="p-4 lg:p-6 flex flex-col gap-5 max-w-[1400px] w-full mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-page-title text-2xl font-semibold text-[var(--brown)]">
              Reports & Downloads
            </h1>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Generated client-side from metrics.ts · Respects active filters ({filteredEmployees.length} employees) and Privacy Mode ({privacyMode ? 'ON' : 'OFF'})
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--amber-tint)]/50 px-3 py-2 text-xs text-[var(--ink-on-amber)] inline-flex items-center gap-2">
            <CalendarClock className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Schedule reminder: upload fresh workforce exports weekly to track trends accurately.</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* 1. Executive Summary PDF */}
          <article className="card-surface p-4 flex flex-col justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--brown)]">Executive Workforce Summary</h2>
              <p className="text-xs text-[var(--muted)] mt-1">
                A4 PDF pack with the 8 KPIs, department engagement table, ECharts visuals, warning sign counts, 5 key insights, and top 3 recommended actions.
              </p>
            </div>
            <button
              type="button"
              disabled={generatingKey === 'exec'}
              onClick={() =>
                runDownload(
                  'exec',
                  () =>
                    exportExecutiveSummaryPdf({
                      employees: filteredEmployees,
                      previousEmployees: previousSnapshot?.employees,
                      settings,
                      filters,
                      engagementScaleMax: activeSnapshot.engagementScaleMax,
                      sourceFile: activeSnapshot.fileName,
                      uploadDate,
                      privacyMode,
                      chartImages: buildExecutiveChartImages(),
                    }),
                  'Executive Workforce Summary PDF'
                )
              }
              className="btn-primary py-2 px-3 text-xs inline-flex items-center justify-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              {generatingKey === 'exec' ? 'Generating...' : 'Download PDF'}
            </button>
          </article>

          {/* 2. Employee Details Export */}
          <article className="card-surface p-4 flex flex-col justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--brown)]">Employee Details Export</h2>
              <p className="text-xs text-[var(--muted)] mt-1">
                Filtered employee roster ({filteredEmployees.length} rows). XLSX includes a second metadata sheet with active filters and definitions.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  runDownload(
                    'emp_csv',
                    () =>
                      exportEmployeeDetails({
                        format: 'csv',
                        employees: filteredEmployees,
                        privacyMode,
                        filters,
                        engagementScaleMax: activeSnapshot.engagementScaleMax,
                        sourceFile: activeSnapshot.fileName,
                      }),
                    'Employee Details CSV'
                  )
                }
                className="btn-secondary flex-1 py-2 text-xs inline-flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                CSV
              </button>
              <button
                type="button"
                onClick={() =>
                  runDownload(
                    'emp_xlsx',
                    () =>
                      exportEmployeeDetails({
                        format: 'xlsx',
                        employees: filteredEmployees,
                        privacyMode,
                        filters,
                        engagementScaleMax: activeSnapshot.engagementScaleMax,
                        sourceFile: activeSnapshot.fileName,
                      }),
                    'Employee Details XLSX'
                  )
                }
                className="btn-primary flex-1 py-2 text-xs inline-flex items-center justify-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                XLSX
              </button>
            </div>
          </article>

          {/* 3. At-Risk Employees List */}
          <article className="card-surface p-4 flex flex-col justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--brown)]">At-Risk Employees List</h2>
              <p className="text-xs text-[var(--muted)] mt-1">
                Employees in High and Critical risk bands ({filteredEmployees.filter((e) => e.riskBand === 'High' || e.riskBand === 'Critical').length} in view) with signals, drivers, and first actions.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  runDownload(
                    'risk_xlsx',
                    () =>
                      exportAtRiskList({
                        format: 'xlsx',
                        employees: filteredEmployees,
                        privacyMode,
                        filters,
                        sourceFile: activeSnapshot.fileName,
                        uploadDate,
                      }),
                    'At-Risk List XLSX'
                  )
                }
                className="btn-secondary flex-1 py-2 text-xs inline-flex items-center justify-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                XLSX
              </button>
              <button
                type="button"
                onClick={() =>
                  runDownload(
                    'risk_pdf',
                    () =>
                      exportAtRiskList({
                        format: 'pdf',
                        employees: filteredEmployees,
                        privacyMode,
                        filters,
                        sourceFile: activeSnapshot.fileName,
                        uploadDate,
                      }),
                    'At-Risk List PDF'
                  )
                }
                className="btn-primary flex-1 py-2 text-xs inline-flex items-center justify-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                PDF
              </button>
            </div>
          </article>

          {/* 4. Department Deep Dive */}
          <article className="card-surface p-4 flex flex-col justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--brown)]">Department Deep Dive</h2>
              <p className="text-xs text-[var(--muted)] mt-1">
                KPIs, job level engagement, and flagged employees for a single department.
              </p>
              <select
                value={effectiveDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                aria-label="Select department for deep dive PDF"
                className="mt-2 w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--surface)] text-xs"
              >
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={!effectiveDept}
              onClick={() =>
                runDownload(
                  'dept_pdf',
                  () =>
                    exportDepartmentDeepDivePdf({
                      department: effectiveDept,
                      employees: allEmployees,
                      settings,
                      engagementScaleMax: activeSnapshot.engagementScaleMax,
                      privacyMode,
                      sourceFile: activeSnapshot.fileName,
                      uploadDate,
                    }),
                  `${effectiveDept} Deep Dive PDF`
                )
              }
              className="btn-primary py-2 text-xs inline-flex items-center justify-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              Download PDF
            </button>
          </article>

          {/* 5. Individual Retention Plan */}
          <article className="card-surface p-4 flex flex-col justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--brown)]">Individual Retention Plan</h2>
              <p className="text-xs text-[var(--muted)] mt-1">
                One-page action plan with implementation steps, manager 1:1 guide, and KPI targets.
              </p>
              <select
                value={effectiveEmpId}
                onChange={(e) => setSelectedEmpId(e.target.value)}
                aria-label="Select employee for individual retention plan PDF"
                className="mt-2 w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--surface)] text-xs"
              >
                {[...allEmployees]
                  .sort((a, b) => b.riskScore - a.riskScore)
                  .slice(0, 40)
                  .map((e) => (
                    <option key={e.employeeId} value={e.employeeId}>
                      {maskEmployeeName(e.employeeName, e.employeeId, privacyMode)} (Risk {e.riskScore})
                    </option>
                  ))}
              </select>
            </div>
            <button
              type="button"
              disabled={!effectiveEmpId}
              onClick={() =>
                runDownload(
                  'plan_pdf',
                  () => {
                    const existing = recommendations.find(
                      (r) => r.scopeKey === `employee:${effectiveEmpId}`
                    );
                    const plan =
                      existing?.plan ??
                      (() => {
                        const b = buildEvidencePack(
                          'employee',
                          effectiveEmpId,
                          allEmployees,
                          settings,
                          privacyMode,
                          settings.includeNamesInAI
                        );
                        return buildPlaybookFallbackPlan(
                          b.evidencePack,
                          b.candidateActions,
                          b.targetEmployees,
                          settings
                        );
                      })();
                    exportRetentionPlanPdf({
                      plan,
                      privacyMode,
                      sourceFile: activeSnapshot.fileName,
                      uploadDate,
                    });
                  },
                  'Individual Retention Plan PDF'
                )
              }
              className="btn-primary py-2 text-xs inline-flex items-center justify-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              Download PDF
            </button>
          </article>

          {/* 6. Model & Data Quality Reports */}
          <article className="card-surface p-4 flex flex-col justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--brown)]">Model & Data Quality Reports</h2>
              <p className="text-xs text-[var(--muted)] mt-1">
                Model leaderboard, calibration, and fairness audit (PDF), plus Data Quality & cleaning decisions log (CSV / PDF).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  runDownload(
                    'model_pdf',
                    () =>
                      exportModelReportPdf({
                        model: activeModel ?? models[0] ?? null,
                        settings,
                        sourceFile: activeSnapshot.fileName,
                        uploadDate,
                        privacyMode,
                      }),
                    'Model Report PDF'
                  )
                }
                className="btn-secondary flex-1 py-2 px-2 text-xs"
              >
                Model PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  runDownload(
                    'dq_csv',
                    () =>
                      exportDataQualityReport({
                        format: 'csv',
                        report: activeSnapshot.dataQualityReport,
                        sourceFile: activeSnapshot.fileName,
                        uploadDate,
                        privacyMode,
                      }),
                    'Data Quality CSV'
                  )
                }
                className="btn-secondary flex-1 py-2 px-2 text-xs"
              >
                Quality CSV
              </button>
              <button
                type="button"
                onClick={() =>
                  runDownload(
                    'dq_pdf',
                    () =>
                      exportDataQualityReport({
                        format: 'pdf',
                        report: activeSnapshot.dataQualityReport,
                        sourceFile: activeSnapshot.fileName,
                        uploadDate,
                        privacyMode,
                      }),
                    'Data Quality PDF'
                  )
                }
                className="btn-primary flex-1 py-2 px-2 text-xs"
              >
                Quality PDF
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
};
