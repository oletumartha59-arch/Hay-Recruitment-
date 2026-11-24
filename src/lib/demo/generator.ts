import type { WorkforceSettings } from '../../types/workforce';
import { cleanText } from '../clean/fuzzy';

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Oliver', 'Amelia', 'George', 'Isla', 'Arthur', 'Ava', 'Noah', 'Mia',
  'Leo', 'Grace', 'Harry', 'Freya', 'Charlie', 'Lily', 'Jack', 'Sophia',
  'Jacob', 'Emily', 'Thomas', 'Poppy', 'Oscar', 'Chloe', 'Henry', 'Evie',
  'Alfie', 'Hannah', 'William', 'Charlotte', 'Theodore', 'Ella',
];

const LAST_NAMES = [
  'Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Johnson', 'Davies',
  'Robinson', 'Wright', 'Thompson', 'Evans', 'Walker', 'White', 'Roberts', 'Green',
  'Hall', 'Wood', 'Jackson', 'Clarke', 'Patel', 'Khan', 'Hughes', 'Edwards',
  'Bennett', 'Turner', 'Morgan', 'Cooper', 'Ward', 'Bailey',
];

const DEPARTMENTS = [
  'Technology Recruitment',
  'Finance',
  'Operations',
  'Executive Search',
  'Sales',
  'Human Resources',
];

const LOCATIONS = ['London', 'Manchester', 'Birmingham', 'Leeds', 'Edinburgh'];

const JOB_LEVELS = [
  'Graduate',
  'Junior',
  'Consultant',
  'Senior Consultant',
  'Manager',
  'Director',
];

const ARRANGEMENTS = ['Hybrid', 'Office', 'Remote'] as const;

export function generateDemoRawRows(): Array<Record<string, unknown>> {
  const rand = mulberry32(20261124);
  const rows: Array<Record<string, unknown>> = [];

  const baseDateMs = Date.UTC(2026, 10, 20); // 2026-11-20

  for (let i = 1; i <= 300; i++) {
    const id = `HAY${String(1000 + i)}`;
    const firstName = FIRST_NAMES[(i * 7 + Math.floor(rand() * 10)) % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i * 11 + Math.floor(rand() * 10)) % LAST_NAMES.length];

    let dept = DEPARTMENTS[i % DEPARTMENTS.length];
    // Plant inconsistent department spellings in a few rows
    if (i % 45 === 0) dept = 'H.R.';
    if (i % 62 === 0) dept = 'ops';

    const levelIdx = Math.min(JOB_LEVELS.length - 1, Math.floor(rand() * JOB_LEVELS.length));
    const jobLevel = JOB_LEVELS[levelIdx];
    const location = LOCATIONS[i % LOCATIONS.length];
    const workArrangement = ARRANGEMENTS[i % ARRANGEMENTS.length];

    // Status distribution
    const rStatus = rand();
    let workStatus: string =
      rStatus < 0.48 ? 'Present' : rStatus < 0.80 ? 'Remote' : rStatus < 0.92 ? 'Leave' : 'Absent';

    // Plant 15 inconsistent status spellings
    if (i <= 15) {
      const variants = ['WFH', 'Working from home', 'In office', 'Annual leave', 'Sick', 'No show'];
      workStatus = variants[i % variants.length];
    }

    // Tenure between 2 months and 72 months
    const tenureDays = Math.floor(45 + rand() * 2100);
    const hireMs = baseDateMs - tenureDays * 86400000;
    const hireDt = new Date(hireMs);

    // 20 stale records (> 30 days old)
    const isStale = i > 20 && i <= 40;
    const updatedOffsetDays = isStale ? 35 + Math.floor(rand() * 35) : Math.floor(rand() * 12);
    const updDt = new Date(baseDateMs - updatedOffsetDays * 86400000);

    // Mixed date formats: UK DD/MM/YYYY, ISO YYYY-MM-DD, Excel serial
    const fmtDate = (d: Date, variant: number): unknown => {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      if (variant % 3 === 0) return `${dd}/${mm}/${yyyy}`;
      if (variant % 3 === 1) return `${yyyy}-${mm}-${dd}`;
      // Excel serial
      return Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
    };

    const completed = 6 + Math.floor(rand() * 24);
    const pending = 2 + Math.floor(rand() * 12);
    let overdue = Math.floor(rand() * 6);
    let engagement = 5 + Math.floor(rand() * 6); // 5..10 scale
    let workload = pending + overdue > 12 ? 'High' : pending + overdue > 6 ? 'Medium' : 'Low';
    const leaveRemaining = Math.floor(2 + rand() * 22);
    let attentionStatus = 'OK';
    let attentionReason = '';

    // Make Operations & Sales slightly higher stress
    if (dept === 'Operations' && rand() < 0.45) {
      engagement = 3 + Math.floor(rand() * 3);
      overdue = 5 + Math.floor(rand() * 7);
      workload = 'High';
    }

    // Plant 25 employees with warning signs but Attention Status = OK (missed warning signs)
    if (i >= 50 && i < 75) {
      engagement = i % 2 === 0 ? 3 : 5;
      overdue = 6 + (i % 5);
      workload = i % 3 === 0 ? 'Heavy' : 'High';
      attentionStatus = 'OK';
      attentionReason = '';
    } else if (engagement <= 4 || (overdue >= 6 && workload === 'High')) {
      attentionStatus = 'Needs Attention';
      attentionReason =
        engagement <= 4 && workload === 'High'
          ? 'Burnout risk; Overdue deliverables'
          : engagement <= 4
          ? 'Low engagement score; Morale check needed'
          : 'Heavy workload; Missed deadlines';
    }

    let totalTasks: unknown = completed + pending + overdue;
    // Plant 12 non-reconciling task counts
    if (i >= 80 && i < 92) {
      totalTasks = (completed + pending + overdue) + 3;
    }

    // Plant 8 missing numeric values
    let engField: unknown = engagement;
    let leaveField: unknown = leaveRemaining;
    if (i >= 100 && i < 104) engField = 'N/A';
    if (i >= 104 && i < 108) leaveField = '';

    rows.push({
      'Employee ID': id,
      'Employee Name': `${firstName} ${lastName}`,
      Department: dept,
      'Job Level': jobLevel,
      Location: location,
      'Work Arrangement': workArrangement,
      'Work Status': workStatus,
      'Hire Date': fmtDate(hireDt, i),
      'Last Updated': fmtDate(updDt, i + 1),
      'Total Tasks': totalTasks,
      'Completed Tasks': completed,
      'Pending Tasks': pending,
      'Overdue Tasks': overdue,
      'Engagement Score': engField,
      'Workload Level': workload,
      'Leave Days Remaining': leaveField,
      'Attention Status': attentionStatus,
      'Attention Reason': attentionReason,
    });
  }

  // Plant 10 duplicate IDs (5 exact duplicates, 5 conflicting with older Last Updated)
  for (let d = 0; d < 5; d++) {
    rows.push({ ...rows[d] });
  }
  for (let c = 5; c < 10; c++) {
    rows.push({
      ...rows[c],
      'Last Updated': '01/01/2025',
      'Engagement Score': 9,
    });
  }

  return rows;
}

export const DEMO_COLUMN_MAPPING: Record<string, string> = {
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
  engagementScore: 'Engagement Score',
  workloadLevel: 'Workload Level',
  leaveDaysRemaining: 'Leave Days Remaining',
  attentionStatus: 'Attention Status',
  attentionReason: 'Attention Reason',
};

export function createBlankCsvTemplate(): string {
  const headers = [
    'Employee ID',
    'Employee Name',
    'Department',
    'Job Level',
    'Location',
    'Work Arrangement',
    'Work Status',
    'Hire Date',
    'Last Updated',
    'Total Tasks',
    'Completed Tasks',
    'Pending Tasks',
    'Overdue Tasks',
    'Engagement Score',
    'Workload Level',
    'Leave Days Remaining',
    'Attention Status',
    'Attention Reason',
  ];
  return `${headers.join(',')}\n`;
}

export function sanitizeCsvCell(val: unknown): string {
  const s = cleanText(val);
  // Prevent CSV formula injection
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildSettingBandPreview(
  employeesCount: number,
  recalculatedBands: Array<{ before: string; after: string }>
): number {
  let changed = 0;
  for (const item of recalculatedBands) {
    if (item.before !== item.after) changed += 1;
  }
  return Math.min(employeesCount, changed);
}

export function normalizeSettingsWeights(
  weights: WorkforceSettings['riskWeights'],
  changedKey: keyof WorkforceSettings['riskWeights'],
  newValue: number
): WorkforceSettings['riskWeights'] {
  const clamped = Math.max(0, Math.min(100, Math.round(newValue)));
  const remainder = 100 - clamped;
  const otherKeys = (['engagement', 'workload', 'delivery', 'tenure'] as const).filter(
    (k) => k !== changedKey
  );
  const currentOthersSum = otherKeys.reduce((acc, k) => acc + weights[k], 0);
  const next = { ...weights, [changedKey]: clamped };

  if (currentOthersSum === 0) {
    const share = Math.floor(remainder / otherKeys.length);
    otherKeys.forEach((k, idx) => {
      next[k] = idx === 0 ? remainder - share * (otherKeys.length - 1) : share;
    });
  } else {
    let assigned = 0;
    otherKeys.forEach((k, idx) => {
      if (idx === otherKeys.length - 1) {
        next[k] = Math.max(0, remainder - assigned);
      } else {
        const val = Math.round((weights[k] / currentOthersSum) * remainder);
        next[k] = val;
        assigned += val;
      }
    });
  }
  return next;
}
