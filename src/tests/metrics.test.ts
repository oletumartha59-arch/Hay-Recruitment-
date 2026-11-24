import { describe, expect, it } from 'vitest';
import {
  standardiseDepartment,
  standardiseWorkStatus,
  standardiseWorkloadLevel,
} from '../lib/clean/aliases';
import { parseUkDate } from '../lib/clean/dates';
import { runCleaningPipeline, reconcileTaskTotals } from '../lib/clean/pipeline';
import { DEMO_COLUMN_MAPPING, generateDemoRawRows } from '../lib/demo/generator';
import {
  aggregateByGroup,
  compareTwoGroups,
  computeHeadlineKpis,
  filterEmployees,
  maskEmployeeName,
} from '../lib/metrics';
import { DEFAULT_SETTINGS, INITIAL_FILTER_STATE } from '../types/workforce';

describe('Aliases, UK Date Parser, and Cleaning Pipeline', () => {
  it('standardises departments, work statuses, and workload levels', () => {
    expect(standardiseDepartment('h.r.').value).toBe('Human Resources');
    expect(standardiseDepartment('OPS').value).toBe('Operations');
    expect(standardiseWorkStatus('WFH').value).toBe('Remote');
    expect(standardiseWorkStatus('Annual leave').value).toBe('Leave');
    expect(standardiseWorkStatus('In office').value).toBe('Present');
    expect(standardiseWorkStatus('No show').value).toBe('Absent');
    expect(standardiseWorkloadLevel('Overloaded').value).toBe('High');
  });

  it('parses UK day-first, ISO, and Excel serial dates and flags future dates', () => {
    const uk = parseUkDate('03/04/2026', '2026-11-24');
    expect(uk.iso).toBe('2026-04-03');
    expect(uk.wasAmbiguous).toBe(true);

    const iso = parseUkDate('2025-09-15', '2026-11-24');
    expect(iso.iso).toBe('2025-09-15');
    expect(iso.wasAmbiguous).toBe(false);

    const excel = parseUkDate(45658, '2026-11-24'); // 2025-01-01
    expect(excel.iso).toBe('2025-01-01');

    const future = parseUkDate('01/01/2028', '2026-11-24');
    expect(future.isFuture).toBe(true);
  });

  it('enforces boundary values for engagement (60%, 40%) and overdue share (30%)', () => {
    const rows = [
      // Exactly 60% engagement (6/10) -> NOT low_engagement
      {
        'Employee ID': 'B1',
        'Employee Name': 'Alice Boundary',
        Department: 'Sales',
        'Job Level': 'Consultant',
        Location: 'London',
        'Work Arrangement': 'Hybrid',
        'Work Status': 'Present',
        'Hire Date': '01/01/2024',
        'Last Updated': '20/11/2026',
        'Total Tasks': 10,
        'Completed Tasks': 7,
        'Pending Tasks': 2,
        'Overdue Tasks': 1, // 1/3 = 33.3% >= 30% -> heavy_workload
        'Engagement Score': 6,
        'Workload Level': 'Medium',
        'Leave Days Remaining': 5,
        'Attention Status': 'OK',
        'Attention Reason': '',
      },
      // Exactly 40% engagement (4/10) -> low_engagement (not critical_engagement, which is < 40%)
      {
        'Employee ID': 'B2',
        'Employee Name': 'Bob Boundary',
        Department: 'Sales',
        'Job Level': 'Consultant',
        Location: 'London',
        'Work Arrangement': 'Office',
        'Work Status': 'Present',
        'Hire Date': '01/01/2024',
        'Last Updated': '20/11/2026',
        'Total Tasks': 20,
        'Completed Tasks': 10,
        'Pending Tasks': 7,
        'Overdue Tasks': 3, // 3/10 = 30.0% -> exactly 30% -> heavy_workload
        'Engagement Score': 4,
        'Workload Level': 'Medium',
        'Leave Days Remaining': 5,
        'Attention Status': 'OK',
        'Attention Reason': '',
      },
      // 39% engagement (39/100 scale override) -> critical_engagement
      {
        'Employee ID': 'B3',
        'Employee Name': 'Cara Critical',
        Department: 'Sales',
        'Job Level': 'Consultant',
        Location: 'London',
        'Work Arrangement': 'Remote',
        'Work Status': 'Remote',
        'Hire Date': '01/01/2024',
        'Last Updated': '20/11/2026',
        'Total Tasks': 10,
        'Completed Tasks': 8,
        'Pending Tasks': 2,
        'Overdue Tasks': 0,
        'Engagement Score': 3,
        'Workload Level': 'Low',
        'Leave Days Remaining': 5,
        'Attention Status': 'OK',
        'Attention Reason': '',
      },
    ];

    const res = runCleaningPipeline(rows, {
      mapping: DEMO_COLUMN_MAPPING,
      settings: { ...DEFAULT_SETTINGS, engagementScaleOverride: 10 },
      referenceTodayIso: '2026-11-24',
    });

    const b1 = res.employees.find((e) => e.employeeId === 'B1')!;
    const b2 = res.employees.find((e) => e.employeeId === 'B2')!;
    const b3 = res.employees.find((e) => e.employeeId === 'B3')!;

    expect(b1.signals.some((s) => s.code === 'low_engagement')).toBe(false);
    expect(b1.signals.some((s) => s.code === 'heavy_workload')).toBe(true);

    expect(b2.signals.some((s) => s.code === 'low_engagement')).toBe(true);
    expect(b2.signals.some((s) => s.code === 'critical_engagement')).toBe(false);
    expect(b2.signals.some((s) => s.code === 'heavy_workload')).toBe(true);

    expect(b3.signals.some((s) => s.code === 'critical_engagement')).toBe(true);
  });

  it('cleans 300-row demo data, catches task mismatches, and reconciles on one click', () => {
    const raw = generateDemoRawRows();
    const res = runCleaningPipeline(raw, {
      mapping: DEMO_COLUMN_MAPPING,
      settings: DEFAULT_SETTINGS,
      referenceTodayIso: '2026-11-24',
    });

    expect(res.employees.length).toBe(300);
    expect(res.report.duplicatesRemoved).toBe(5);
    expect(res.report.conflictsResolved.length).toBe(5);

    const kpis = computeHeadlineKpis(res.employees, res.engagementScaleMax);
    expect(kpis.statusReconciles).toBe(true);
    expect(kpis.present.count + kpis.remote.count + kpis.leave.count + kpis.absent.count).toBe(300);
    expect(kpis.warningCounts.missedWarningSigns).toBeGreaterThanOrEqual(20);

    const reconciled = reconcileTaskTotals(res.employees);
    expect(reconciled.every((e) => e.dataQuality.taskReconciled)).toBe(true);
  });

  it('masks names in Privacy Mode and computes aggregations & comparisons without NaN', () => {
    const raw = generateDemoRawRows().slice(0, 40);
    const res = runCleaningPipeline(raw, {
      mapping: DEMO_COLUMN_MAPPING,
      settings: DEFAULT_SETTINGS,
      referenceTodayIso: '2026-11-24',
    });

    expect(maskEmployeeName('Oliver Smith', 'HAY1001', true)).toBe('Oliver S. (HAY1001)');
    expect(maskEmployeeName('Oliver Smith', 'HAY1001', false)).toBe('Oliver Smith');

    const empty = filterEmployees(res.employees, { ...INITIAL_FILTER_STATE, departments: ['NonExistent'] });
    const emptyKpis = computeHeadlineKpis(empty, res.engagementScaleMax);
    expect(emptyKpis.avgEngagementScore).toBeNull();
    expect(emptyKpis.present.sharePct).toBeNull();

    const byDept = aggregateByGroup(res.employees, 'engagementPct', 'department', 'mean');
    expect(byDept.length).toBeGreaterThan(0);

    const cmp = compareTwoGroups(
      res.employees,
      'engagementPct',
      { field: 'workArrangement', value: 'Remote' },
      { field: 'workArrangement', value: 'Office' }
    );
    expect(cmp.groupA.n).toBeGreaterThan(0);
    expect(cmp.groupB.n).toBeGreaterThan(0);
  });
});
