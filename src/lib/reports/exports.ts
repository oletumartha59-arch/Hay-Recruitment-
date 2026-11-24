import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type {
  DataQualityReport,
  EmployeeRecord,
  GlobalFilterState,
  RetentionPlan,
  TrainedModelSummary,
  WorkforceSettings,
} from '../../types/workforce';
import { formatUkDate } from '../clean/dates';
import { sanitizeCsvCell } from '../demo/generator';
import {
  aggregateByGroup,
  computeHeadlineKpis,
  generateDeptEngagementInsight,
  maskEmployeeName,
} from '../metrics';
import { BRAND_TOKENS } from '../../theme/tokens';

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatReportFilename(reportSlug: string, ext: string): string {
  return `hay-${reportSlug}-${todayStamp()}.${ext}`;
}

export function summarizeActiveFilters(filters: GlobalFilterState): string {
  const parts: string[] = [];
  if (filters.departments.length) parts.push(`Dept: ${filters.departments.join(', ')}`);
  if (filters.locations.length) parts.push(`Location: ${filters.locations.join(', ')}`);
  if (filters.workStatuses.length) parts.push(`Status: ${filters.workStatuses.join(', ')}`);
  if (filters.jobLevels.length) parts.push(`Level: ${filters.jobLevels.join(', ')}`);
  if (filters.riskBands.length) parts.push(`Risk: ${filters.riskBands.join(', ')}`);
  if (filters.signalTypes.length) parts.push(`Signals: ${filters.signalTypes.join(', ')}`);
  if (filters.staleOnly) parts.push('Stale only');
  if (filters.search) parts.push(`Search: "${filters.search}"`);
  return parts.length > 0 ? parts.join(' | ') : 'All employees (no filters)';
}

function triggerDownloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addPdfHeaderAndFooter(
  doc: jsPDF,
  title: string,
  meta: { sourceFile: string; uploadDate: string; filterSummary: string; privacyMode: boolean }
) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Header bar
    doc.setFillColor(BRAND_TOKENS.brown);
    doc.rect(0, 0, pageWidth, 14, 'F');
    doc.setTextColor('#FBF6EC');
    doc.setFontSize(10);
    doc.text('Hay Recruitment Workforce AI Central', 14, 9);
    doc.setFontSize(8.5);
    doc.text(title, pageWidth - 14, 9, { align: 'right' });

    // Footer
    doc.setDrawColor(BRAND_TOKENS.border);
    doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14);
    doc.setTextColor(BRAND_TOKENS.muted);
    doc.setFontSize(7.5);
    const leftFooter = `Source: ${meta.sourceFile} (${meta.uploadDate}) · Filters: ${meta.filterSummary.slice(0, 65)}${
      meta.privacyMode ? ' · Privacy Mode ON' : ''
    }`;
    doc.text(leftFooter, 14, pageHeight - 9);
    doc.text(
      `Decision support, requires human review · Generated ${new Date().toLocaleString('en-GB')} · Page ${i}/${pageCount}`,
      pageWidth - 14,
      pageHeight - 9,
      { align: 'right' }
    );
  }
}

export function downloadCsvRows(
  headers: string[],
  rows: Array<Array<unknown>>,
  filename: string
) {
  const lines = [
    headers.map((h) => sanitizeCsvCell(h)).join(','),
    ...rows.map((r) => r.map((cell) => sanitizeCsvCell(cell)).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownloadBlob(blob, filename);
}

export function exportEmployeeDetails(params: {
  format: 'csv' | 'xlsx';
  employees: EmployeeRecord[];
  visibleColumns?: string[];
  privacyMode: boolean;
  filters: GlobalFilterState;
  engagementScaleMax: number;
  sourceFile: string;
}) {
  const { format, employees, privacyMode, filters, engagementScaleMax, sourceFile } = params;
  const cols = params.visibleColumns ?? [
    'employeeId',
    'employeeName',
    'department',
    'jobLevel',
    'location',
    'workArrangement',
    'workStatus',
    'hireDate',
    'lastUpdated',
    'totalTasks',
    'completedTasks',
    'pendingTasks',
    'overdueTasks',
    'engagementScore',
    'workloadLevel',
    'leaveDaysRemaining',
    'attentionStatus',
    'riskScore',
    'riskBand',
    'signals',
  ];

  const colLabels: Record<string, string> = {
    employeeId: 'Employee ID',
    employeeName: 'Employee Name',
    department: 'Department',
    jobLevel: 'Job Level',
    location: 'Location',
    workArrangement: 'Work Arrangement',
    workStatus: 'Work Status',
    hireDate: 'Hire Date',
    lastUpdated: 'Last Updated',
    totalTasks: 'Total Tasks',
    completedTasks: 'Completed Tasks',
    pendingTasks: 'Pending Tasks',
    overdueTasks: 'Overdue Tasks',
    engagementScore: `Engagement Score (/${engagementScaleMax})`,
    workloadLevel: 'Workload Level',
    leaveDaysRemaining: 'Leave Days Remaining',
    attentionStatus: 'Attention Status',
    attentionReason: 'Attention Reason',
    riskScore: 'Risk Score',
    riskBand: 'Risk Band',
    signals: 'Computed Signals',
  };

  const mapRow = (emp: EmployeeRecord) =>
    cols.map((c) => {
      if (c === 'employeeName') return maskEmployeeName(emp.employeeName, emp.employeeId, privacyMode);
      if (c === 'hireDate' || c === 'lastUpdated') return formatUkDate(emp[c]);
      if (c === 'signals') return emp.signals.map((s) => s.label).join('; ') || 'None';
      return (emp as unknown as Record<string, unknown>)[c] ?? '';
    });

  const headers = cols.map((c) => colLabels[c] ?? c);
  const rows = employees.map(mapRow);

  if (format === 'csv') {
    downloadCsvRows(headers, rows, formatReportFilename('employee-details', 'csv'));
    return;
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');

  const metaSheet = XLSX.utils.aoa_to_sheet([
    ['Hay Recruitment Workforce AI Central — Export Metadata'],
    ['Generated At', new Date().toISOString()],
    ['Source File', sourceFile],
    ['Privacy Mode', privacyMode ? 'Enabled (Names Masked)' : 'Disabled'],
    ['Active Filters', summarizeActiveFilters(filters)],
    ['Rows Exported', employees.length],
    ['Notice', 'Decision support, requires human review.'],
    [],
    ['Metric Definitions'],
    ['Risk Score', '0 to 100 composite score (higher indicates higher retention risk)'],
    ['Overdue Share', 'Overdue Tasks / (Pending Tasks + Overdue Tasks)'],
    ['Completion Rate', 'Completed Tasks / Total Tasks'],
  ]);
  XLSX.utils.book_append_sheet(wb, metaSheet, 'Filters & Definitions');
  XLSX.writeFile(wb, formatReportFilename('employee-details', 'xlsx'));
}

export function exportExecutiveSummaryPdf(params: {
  employees: EmployeeRecord[];
  previousEmployees?: EmployeeRecord[];
  settings: WorkforceSettings;
  filters: GlobalFilterState;
  engagementScaleMax: number;
  sourceFile: string;
  uploadDate: string;
  privacyMode: boolean;
  chartImages?: Array<{ title: string; dataUrl: string }>;
}) {
  const {
    employees,
    previousEmployees,
    settings,
    filters,
    engagementScaleMax,
    sourceFile,
    uploadDate,
    privacyMode,
    chartImages = [],
  } = params;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const kpis = computeHeadlineKpis(employees, engagementScaleMax, previousEmployees);

  // Page 1: Executive KPIs & Insights
  doc.setTextColor(BRAND_TOKENS.brown);
  doc.setFontSize(18);
  doc.text('Executive Workforce Summary', 14, 24);
  doc.setFontSize(10);
  doc.setTextColor(BRAND_TOKENS.muted);
  doc.text(`Scope: ${summarizeActiveFilters(filters)} (${employees.length} employees)`, 14, 30);

  autoTable(doc, {
    startY: 36,
    head: [['Metric', 'Value', 'Share / Context']],
    body: [
      ['Total Employees', String(kpis.totalEmployees), '100% of active selection'],
      ['Present', String(kpis.present.count), `${kpis.present.sharePct ?? 0}%`],
      ['Remote', String(kpis.remote.count), `${kpis.remote.sharePct ?? 0}%`],
      ['Leave', String(kpis.leave.count), `${kpis.leave.sharePct ?? 0}%`],
      ['Absent', String(kpis.absent.count), `${kpis.absent.sharePct ?? 0}%`],
      [
        'Avg Engagement Score',
        kpis.avgEngagementScore !== null ? `${kpis.avgEngagementScore} / ${engagementScaleMax}` : 'n/a',
        kpis.avgEngagementPct !== null ? `${kpis.avgEngagementPct}% of scale` : 'n/a',
      ],
      [
        'Needs Attention (HR Flag)',
        String(kpis.needsAttention.count),
        `${kpis.needsAttention.sharePct ?? 0}% (+${kpis.warningCounts.missedWarningSigns} missed warning signs)`,
      ],
      ['Pending Tasks', String(kpis.pendingTasks), `${kpis.overdueTasks} Overdue Tasks`],
    ],
    headStyles: { fillColor: BRAND_TOKENS.brown, textColor: '#FBF6EC' },
    alternateRowStyles: { fillColor: BRAND_TOKENS.surface },
    styles: { fontSize: 9, textColor: BRAND_TOKENS.brown },
  });

  const insights = [
    generateDeptEngagementInsight(employees, settings),
    `${kpis.warningCounts.missedWarningSigns} employees trigger Warning/Critical rules while Attention Status remains OK.`,
    `${kpis.warningCounts.burnoutPattern} employees exhibit combined heavy workload and low engagement (Burnout pattern).`,
    `${kpis.warningCounts.heavyWorkload} employees meet the Heavy Workload threshold (>= ${settings.heavyWorkloadOverduePct}% overdue or High load).`,
    `Overdue task load totals ${kpis.overdueTasks} tasks alongside ${kpis.pendingTasks} pending tasks.`,
  ];

  const afterTableY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(12);
  doc.setTextColor(BRAND_TOKENS.brown);
  doc.text('5 Key Workforce Insights', 14, afterTableY);
  doc.setFontSize(9.5);
  insights.forEach((line, idx) => {
    doc.text(`${idx + 1}. ${line}`, 14, afterTableY + 7 + idx * 6, { maxWidth: 180 });
  });

  // Page 2: Department Breakdown & Charts
  doc.addPage();
  doc.setFontSize(14);
  doc.setTextColor(BRAND_TOKENS.brown);
  doc.text('Department Breakdown & Engagement', 14, 24);

  const deptRows = aggregateByGroup(employees, 'engagementPct', 'department', 'mean', settings.smallSampleThreshold)
    .sort((a, b) => (a.value ?? 100) - (b.value ?? 100));
  const deptRiskRows = aggregateByGroup(employees, 'riskScore', 'department', 'mean', settings.smallSampleThreshold);
  const riskByDept = new Map(deptRiskRows.map((d) => [d.group, d.value]));

  autoTable(doc, {
    startY: 30,
    head: [['Department', 'Headcount', 'Avg Engagement %', 'Avg Risk Score', 'Note']],
    body: deptRows.map((d) => [
      d.group,
      String(d.count),
      d.value !== null ? `${d.value}%` : 'n/a',
      riskByDept.get(d.group) !== null ? String(riskByDept.get(d.group)) : 'n/a',
      d.smallSample ? 'Small sample (<5)' : 'Nominal',
    ]),
    headStyles: { fillColor: BRAND_TOKENS.brown, textColor: '#FBF6EC' },
    styles: { fontSize: 9, textColor: BRAND_TOKENS.brown },
  });

  let chartY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  for (const img of chartImages.slice(0, 2)) {
    if (chartY > 210) {
      doc.addPage();
      chartY = 24;
    }
    doc.setFontSize(10.5);
    doc.text(img.title, 14, chartY);
    doc.addImage(img.dataUrl, 'PNG', 14, chartY + 3, 180, 65);
    chartY += 74;
  }

  // Page 3: Recommended Actions & Top At-Risk
  doc.addPage();
  doc.setFontSize(14);
  doc.text('Priority Recommended Actions & Top Risk Employees', 14, 24);
  const actions = [
    ['P1 (7 days)', 'Audit & triage Missed Warning Signs', `Review all ${kpis.warningCounts.missedWarningSigns} employees with Warning/Critical signals marked OK.`],
    ['P1 (7 days)', 'Burnout workload reset', `Rebalance reqs for the ${kpis.warningCounts.burnoutPattern} employees in Burnout pattern.`],
    ['P2 (30 days)', 'Department stay interviews', `Focus retention check-ins on lowest-engagement departments and High/Critical bands.`],
  ];
  autoTable(doc, {
    startY: 30,
    head: [['Priority', 'Action', 'Evidence Scope']],
    body: actions,
    headStyles: { fillColor: BRAND_TOKENS.amber, textColor: BRAND_TOKENS.inkOnAmber },
    styles: { fontSize: 9, textColor: BRAND_TOKENS.brown },
  });

  const topAtRisk = [...employees].sort((a, b) => b.riskScore - a.riskScore).slice(0, 12);
  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8,
    head: [['ID', 'Employee', 'Department', 'Level', 'Risk', 'Band', 'Top Driver']],
    body: topAtRisk.map((e) => [
      e.employeeId,
      maskEmployeeName(e.employeeName, e.employeeId, privacyMode),
      e.department,
      e.jobLevel,
      String(e.riskScore),
      e.riskBand,
      e.drivers[0] ? `${e.drivers[0].factor} (${e.drivers[0].employeeValue})` : '-',
    ]),
    headStyles: { fillColor: BRAND_TOKENS.brown, textColor: '#FBF6EC' },
    styles: { fontSize: 8.5, textColor: BRAND_TOKENS.brown },
  });

  addPdfHeaderAndFooter(doc, 'Executive Workforce Summary', {
    sourceFile,
    uploadDate,
    filterSummary: summarizeActiveFilters(filters),
    privacyMode,
  });

  doc.save(formatReportFilename('executive-summary', 'pdf'));
}

export function exportAtRiskList(params: {
  format: 'xlsx' | 'pdf';
  employees: EmployeeRecord[];
  privacyMode: boolean;
  filters: GlobalFilterState;
  sourceFile: string;
  uploadDate: string;
}) {
  const { format, employees, privacyMode, filters, sourceFile, uploadDate } = params;
  const atRisk = employees
    .filter((e) => e.riskBand === 'High' || e.riskBand === 'Critical')
    .sort((a, b) => b.riskScore - a.riskScore);

  const headers = ['Employee ID', 'Employee', 'Department', 'Job Level', 'Location', 'Risk Score', 'Band', 'Signals', 'Top Driver', 'Suggested First Action'];
  const rows = atRisk.map((e) => [
    e.employeeId,
    maskEmployeeName(e.employeeName, e.employeeId, privacyMode),
    e.department,
    e.jobLevel,
    e.location,
    e.riskScore,
    e.riskBand,
    e.signals.map((s) => s.label).join('; ') || 'None',
    e.drivers[0] ? `${e.drivers[0].factor}: ${e.drivers[0].employeeValue}` : '-',
    e.signals.some((s) => s.code === 'burnout_pattern')
      ? 'Immediate 1:1 & workload triage'
      : e.signals.some((s) => s.code.includes('engagement'))
      ? 'Confidential stay interview'
      : 'Review overdue tasks & capacity',
  ]);

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'At-Risk Employees');
    XLSX.writeFile(wb, formatReportFilename('at-risk-list', 'xlsx'));
    return;
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(15);
  doc.setTextColor(BRAND_TOKENS.brown);
  doc.text(`At-Risk Employees (High & Critical Bands: ${atRisk.length})`, 14, 22);
  autoTable(doc, {
    startY: 28,
    head: [headers],
    body: rows.map((r) => r.map(String)),
    headStyles: { fillColor: BRAND_TOKENS.riskCritical, textColor: '#FBF6EC' },
    styles: { fontSize: 8, textColor: BRAND_TOKENS.brown },
  });
  addPdfHeaderAndFooter(doc, 'At-Risk Employees List', {
    sourceFile,
    uploadDate,
    filterSummary: summarizeActiveFilters(filters),
    privacyMode,
  });
  doc.save(formatReportFilename('at-risk-list', 'pdf'));
}

export function exportDepartmentDeepDivePdf(params: {
  department: string;
  employees: EmployeeRecord[];
  settings: WorkforceSettings;
  engagementScaleMax: number;
  privacyMode: boolean;
  sourceFile: string;
  uploadDate: string;
}) {
  const { department, employees, settings, engagementScaleMax, privacyMode, sourceFile, uploadDate } = params;
  const deptEmps = employees.filter((e) => e.department === department);
  const kpis = computeHeadlineKpis(deptEmps, engagementScaleMax);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.setTextColor(BRAND_TOKENS.brown);
  doc.text(`Department Deep Dive: ${department}`, 14, 24);
  doc.setFontSize(10);
  doc.setTextColor(BRAND_TOKENS.muted);
  doc.text(`${deptEmps.length} employees · ${kpis.warningCounts.missedWarningSigns} missed warning signs`, 14, 30);

  const byLevel = aggregateByGroup(deptEmps, 'engagementPct', 'jobLevel', 'mean', settings.smallSampleThreshold);
  autoTable(doc, {
    startY: 36,
    head: [['Job Level', 'Employees', 'Avg Engagement %', 'Small Sample Note']],
    body: byLevel.map((l) => [
      l.group,
      String(l.count),
      l.value !== null ? `${l.value}%` : 'n/a',
      l.smallSample ? 'Small sample (<5)' : '-',
    ]),
    headStyles: { fillColor: BRAND_TOKENS.brown, textColor: '#FBF6EC' },
    styles: { fontSize: 9, textColor: BRAND_TOKENS.brown },
  });

  const flagged = deptEmps
    .filter((e) => e.needsAttentionFlag || e.hasWarningOrCriticalSignal)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 20);

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8,
    head: [['ID', 'Employee', 'Level', 'Status', 'Risk', 'Signals']],
    body: flagged.map((e) => [
      e.employeeId,
      maskEmployeeName(e.employeeName, e.employeeId, privacyMode),
      e.jobLevel,
      e.attentionStatus,
      `${e.riskScore} (${e.riskBand})`,
      e.signals.map((s) => s.label).join(', ') || 'None',
    ]),
    headStyles: { fillColor: BRAND_TOKENS.amber, textColor: BRAND_TOKENS.inkOnAmber },
    styles: { fontSize: 8.5, textColor: BRAND_TOKENS.brown },
  });

  addPdfHeaderAndFooter(doc, `Department Deep Dive — ${department}`, {
    sourceFile,
    uploadDate,
    filterSummary: `Department: ${department}`,
    privacyMode,
  });
  doc.save(formatReportFilename(`dept-${department.toLowerCase().replace(/\s+/g, '-')}`, 'pdf'));
}

export function exportRetentionPlanPdf(params: {
  plan: RetentionPlan;
  privacyMode: boolean;
  sourceFile: string;
  uploadDate: string;
}) {
  const { plan, privacyMode, sourceFile, uploadDate } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.setTextColor(BRAND_TOKENS.brown);
  doc.text(`Retention Action Plan (${plan.scope.type.toUpperCase()}: ${plan.scope.id})`, 14, 24);
  doc.setFontSize(9.5);
  doc.text(plan.summary, 14, 31, { maxWidth: 182 });

  autoTable(doc, {
    startY: 46,
    head: [['Priority', 'Recommendation', 'Owner & First Step', 'Simulated Impact', 'KPI Target']],
    body: plan.recommendations.map((r) => [
      r.priority,
      r.title,
      r.steps[0] ? `${r.steps[0].owner} (${r.steps[0].dueInDays}d): ${r.steps[0].action}` : '-',
      `${r.expectedImpact.riskScoreBefore} -> ${r.expectedImpact.riskScoreAfter}`,
      r.kpis[0] ? `${r.kpis[0].name}: ${r.kpis[0].baseline} -> ${r.kpis[0].target}` : '-',
    ]),
    headStyles: { fillColor: BRAND_TOKENS.brown, textColor: '#FBF6EC' },
    styles: { fontSize: 8.5, textColor: BRAND_TOKENS.brown },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  const guide = plan.recommendations.flatMap((r) => r.conversationGuide ?? []);
  if (guide.length > 0 && y < 240) {
    doc.setFontSize(11);
    doc.text('Manager 1:1 Conversation Guide', 14, y);
    doc.setFontSize(9);
    guide.slice(0, 5).forEach((q, i) => {
      doc.text(`• ${q}`, 14, y + 6 + i * 5.5, { maxWidth: 180 });
    });
    y += 12 + Math.min(5, guide.length) * 5.5;
  }

  doc.setFontSize(9);
  doc.setTextColor(BRAND_TOKENS.muted);
  doc.text(`Monitoring: ${plan.monitoringPlan.reviewCadence}`, 14, Math.min(265, y + 4), { maxWidth: 180 });

  addPdfHeaderAndFooter(doc, 'Retention Action Plan', {
    sourceFile,
    uploadDate,
    filterSummary: `${plan.scope.type}: ${plan.scope.id}`,
    privacyMode,
  });
  doc.save(formatReportFilename('retention-plan', 'pdf'));
}

export function exportModelReportPdf(params: {
  model: TrainedModelSummary | null;
  settings: WorkforceSettings;
  sourceFile: string;
  uploadDate: string;
  privacyMode: boolean;
}) {
  const { model, settings, sourceFile, uploadDate, privacyMode } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.setTextColor(BRAND_TOKENS.brown);
  doc.text('Risk & Churn Model Report', 14, 24);
  doc.setFontSize(10);
  doc.text(`Active Mode: ${settings.activeRiskMode}`, 14, 31);

  if (!model) {
    doc.text(
      'Retention Risk Index (rule-weighted) is active. No supervised attrition or proxy model is currently trained.',
      14,
      40,
      { maxWidth: 180 }
    );
    doc.text(
      `Weights: Engagement ${settings.riskWeights.engagement}%, Workload ${settings.riskWeights.workload}%, Delivery ${settings.riskWeights.delivery}%, Tenure ${settings.riskWeights.tenure}%.`,
      14,
      48
    );
  } else {
    doc.text(`Quality Label: ${model.qualityLabel} — ${model.qualityReason}`, 14, 38, { maxWidth: 180 });
    autoTable(doc, {
      startY: 46,
      head: [['Algorithm', 'ROC AUC', 'PR AUC', 'Precision', 'Recall', 'F1', 'Brier']],
      body: model.leaderboard.map((l) => [
        l.label,
        l.rocAuc.toFixed(3),
        l.prAuc.toFixed(3),
        l.precision.toFixed(3),
        l.recall.toFixed(3),
        l.f1.toFixed(3),
        l.brierScore.toFixed(3),
      ]),
      headStyles: { fillColor: BRAND_TOKENS.brown, textColor: '#FBF6EC' },
      styles: { fontSize: 8.5, textColor: BRAND_TOKENS.brown },
    });
  }

  addPdfHeaderAndFooter(doc, 'Model Evaluation & Fairness Report', {
    sourceFile,
    uploadDate,
    filterSummary: 'Full training snapshot',
    privacyMode,
  });
  doc.save(formatReportFilename('model-report', 'pdf'));
}

export function exportDataQualityReport(params: {
  format: 'csv' | 'pdf';
  report: DataQualityReport;
  sourceFile: string;
  uploadDate: string;
  privacyMode: boolean;
}) {
  const { format, report, sourceFile, uploadDate, privacyMode } = params;

  if (format === 'csv') {
    const headers = ['Rule / Decision', 'Type', 'Affected Count', 'Sample Employee IDs / Detail'];
    const rows: Array<Array<unknown>> = [
      ...report.ruleFailures.map((f) => [f.rule, 'Integrity Rule Failure', f.count, f.sampleIds.join('; ')]),
      ...report.cleaningDecisions.map((d) => [
        d.ruleName,
        'Cleaning Decision',
        d.affectedCount,
        d.samples.map((s) => `${s.employeeId}:${s.field}(${s.from}->${s.to})`).join('; '),
      ]),
    ];
    downloadCsvRows(headers, rows, formatReportFilename('data-quality-log', 'csv'));
    return;
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.setTextColor(BRAND_TOKENS.brown);
  doc.text(`Data Quality & Cleaning Report (Score: ${report.overallScore}/100)`, 14, 24);
  doc.setFontSize(9.5);
  doc.text(
    `Completeness: ${report.dimensions.completeness}% · Validity: ${report.dimensions.validity}% · Uniqueness: ${report.dimensions.uniqueness}% · Consistency: ${report.dimensions.consistency}% · Freshness: ${report.dimensions.freshness}%`,
    14,
    31
  );

  autoTable(doc, {
    startY: 38,
    head: [['Rule / Decision', 'Affected Rows', 'Detail']],
    body: [
      ...report.ruleFailures.map((f) => [f.rule, String(f.count), f.description]),
      ...report.cleaningDecisions.map((d) => [d.ruleName, String(d.affectedCount), d.description]),
    ],
    headStyles: { fillColor: BRAND_TOKENS.brown, textColor: '#FBF6EC' },
    styles: { fontSize: 8.5, textColor: BRAND_TOKENS.brown },
  });

  addPdfHeaderAndFooter(doc, 'Data Quality & Cleaning Log', {
    sourceFile,
    uploadDate,
    filterSummary: sourceFile,
    privacyMode,
  });
  doc.save(formatReportFilename('data-quality-log', 'pdf'));
}
