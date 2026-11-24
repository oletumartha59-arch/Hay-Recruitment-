import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { runCleaningPipeline } from '../lib/clean/pipeline';
import { DEMO_COLUMN_MAPPING } from '../lib/demo/generator';
import { computeHeadlineKpis } from '../lib/metrics';
import { DEFAULT_SETTINGS } from '../types/workforce';

const FIXTURE_ROWS = [
  {
    'Employee ID': 'F101',
    'Employee Name': 'Alice Turner',
    Department: 'Operations',
    'Job Level': 'Consultant',
    Location: 'Manchester',
    'Work Arrangement': 'Hybrid',
    'Work Status': 'Remote',
    'Hire Date': '2024-03-01',
    'Last Updated': '2026-11-18',
    'Total Tasks': 20,
    'Completed Tasks': 10,
    'Pending Tasks': 4,
    'Overdue Tasks': 6,
    'Engagement Score': 4,
    'Workload Level': 'High',
    'Leave Days Remaining': 12,
    'Attention Status': 'OK',
    'Attention Reason': '',
  },
  {
    'Employee ID': 'F102',
    'Employee Name': 'Liam Patel',
    Department: 'Finance',
    'Job Level': 'Senior Consultant',
    Location: 'London',
    'Work Arrangement': 'Office',
    'Work Status': 'Present',
    'Hire Date': '2022-07-15',
    'Last Updated': '2026-11-19',
    'Total Tasks': 15,
    'Completed Tasks': 12,
    'Pending Tasks': 2,
    'Overdue Tasks': 1,
    'Engagement Score': 8,
    'Workload Level': 'Medium',
    'Leave Days Remaining': 6,
    'Attention Status': 'OK',
    'Attention Reason': '',
  },
  {
    'Employee ID': 'F103',
    'Employee Name': 'Hannah Green',
    Department: 'Sales',
    'Job Level': 'Manager',
    Location: 'Leeds',
    'Work Arrangement': 'Hybrid',
    'Work Status': 'Leave',
    'Hire Date': '2021-02-10',
    'Last Updated': '2026-11-15',
    'Total Tasks': 12,
    'Completed Tasks': 9,
    'Pending Tasks': 3,
    'Overdue Tasks': 0,
    'Engagement Score': 7,
    'Workload Level': 'Low',
    'Leave Days Remaining': 4,
    'Attention Status': 'Needs Attention',
    'Attention Reason': 'Career check-in',
  },
];

describe('Multi-format Fixture Parity (XLSX, CSV, TSV, JSON)', () => {
  it('produces identical KPIs and employee records across xlsx, csv, tsv, and json', () => {
    // 1. JSON
    const jsonRows = JSON.parse(JSON.stringify(FIXTURE_ROWS)) as Array<Record<string, unknown>>;

    // 2. CSV
    const csvText = Papa.unparse(FIXTURE_ROWS);
    const csvRows = Papa.parse<Record<string, unknown>>(csvText, { header: true }).data;

    // 3. TSV
    const tsvText = Papa.unparse(FIXTURE_ROWS, { delimiter: '\t' });
    const tsvRows = Papa.parse<Record<string, unknown>>(tsvText, { header: true, delimiter: '\t' }).data;

    // 4. XLSX
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(FIXTURE_ROWS);
    XLSX.utils.book_append_sheet(wb, ws, 'Staff');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const wbRead = XLSX.read(buf, { type: 'array' });
    const xlsxRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wbRead.Sheets.Staff);

    const run = (rows: Array<Record<string, unknown>>) => {
      const cleaned = runCleaningPipeline(rows, {
        mapping: DEMO_COLUMN_MAPPING,
        settings: DEFAULT_SETTINGS,
        referenceTodayIso: '2026-11-24',
      });
      return {
        kpis: computeHeadlineKpis(cleaned.employees, cleaned.engagementScaleMax),
        scores: cleaned.employees.map((e) => ({ id: e.employeeId, risk: e.riskScore, signals: e.signals.length })),
      };
    };

    const resJson = run(jsonRows);
    const resCsv = run(csvRows);
    const resTsv = run(tsvRows);
    const resXlsx = run(xlsxRows);

    expect(resCsv).toEqual(resJson);
    expect(resTsv).toEqual(resJson);
    expect(resXlsx).toEqual(resJson);
  });
});
