import type { AttentionStatus, WorkArrangement, WorkStatus, WorkloadLevel } from '../../types/workforce';
import { cleanText, levenshtein, toTitleCase } from './fuzzy';

export interface CanonicalFieldSpec {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const CANONICAL_FIELDS: CanonicalFieldSpec[] = [
  { key: 'employeeId', label: 'Employee ID', required: true, aliases: ['employee id', 'emp id', 'employeeid', 'emp_id', 'staff number', 'staff id', 'id', 'worker id'] },
  { key: 'employeeName', label: 'Employee Name', required: true, aliases: ['employee name', 'name', 'full name', 'staff name', 'employee_name', 'worker name'] },
  { key: 'department', label: 'Department', required: true, aliases: ['department', 'dept', 'team', 'business unit', 'division', 'practice'] },
  { key: 'jobLevel', label: 'Job Level', required: true, aliases: ['job level', 'level', 'role level', 'seniority', 'grade', 'band', 'position level', 'job_level'] },
  { key: 'location', label: 'Location', required: true, aliases: ['location', 'office', 'city', 'branch', 'site', 'region'] },
  { key: 'workArrangement', label: 'Work Arrangement', required: false, aliases: ['work arrangement', 'arrangement', 'working arrangement', 'work mode', 'hybrid status', 'work_arrangement'] },
  { key: 'workStatus', label: 'Work Status', required: true, aliases: ['work status', 'status', 'availability', 'attendance status', 'work_status', 'availability status'] },
  { key: 'hireDate', label: 'Hire Date', required: true, aliases: ['hire date', 'start date', 'date joined', 'joined', 'hire_date', 'joining date'] },
  { key: 'lastUpdated', label: 'Last Updated', required: true, aliases: ['last updated', 'updated', 'updated at', 'refresh date', 'last_updated', 'record date'] },
  { key: 'totalTasks', label: 'Total Tasks', required: true, aliases: ['total tasks', 'tasks total', 'assigned tasks', 'total_tasks', 'tasks'] },
  { key: 'completedTasks', label: 'Completed Tasks', required: true, aliases: ['completed tasks', 'tasks completed', 'done tasks', 'completed_tasks', 'completed'] },
  { key: 'pendingTasks', label: 'Pending Tasks', required: true, aliases: ['pending tasks', 'open tasks', 'in progress tasks', 'pending_tasks', 'pending'] },
  { key: 'overdueTasks', label: 'Overdue Tasks', required: true, aliases: ['overdue tasks', 'late tasks', 'past due tasks', 'overdue_tasks', 'overdue'] },
  { key: 'engagementScore', label: 'Engagement Score', required: true, aliases: ['engagement score', 'engagement', 'eng score', 'engagement_score', 'pulse score'] },
  { key: 'workloadLevel', label: 'Workload Level', required: true, aliases: ['workload level', 'workload', 'load level', 'workload_level', 'capacity'] },
  { key: 'leaveDaysRemaining', label: 'Leave Days Remaining', required: true, aliases: ['leave days remaining', 'leave remaining', 'annual leave remaining', 'unused leave', 'leave_days_remaining', 'holiday remaining'] },
  { key: 'attentionStatus', label: 'Attention Status', required: true, aliases: ['attention status', 'needs attention', 'flagged', 'hr flag', 'attention_status', 'intervention'] },
  { key: 'attentionReason', label: 'Attention Reason', required: false, aliases: ['attention reason', 'flag reason', 'reason', 'attention_reason', 'notes'] },
  { key: 'exitTarget', label: 'Exit / Leaver (Optional)', required: false, aliases: ['left', 'leaver', 'attrition', 'exited', 'exit date', 'termination date', 'left company', 'is_leaver'] },
];

export function normalizeHeader(header: string): string {
  return cleanText(header).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function autoMatchColumns(headers: string[], savedMapping?: Record<string, string>): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedHeaders = new Set<string>();

  for (const field of CANONICAL_FIELDS) {
    if (savedMapping?.[field.key] && headers.includes(savedMapping[field.key])) {
      mapping[field.key] = savedMapping[field.key];
      usedHeaders.add(savedMapping[field.key]);
    }
  }

  for (const field of CANONICAL_FIELDS) {
    if (mapping[field.key]) continue;
    const normalizedCandidates = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));

    // Exact or alias match
    const match = normalizedCandidates.find(
      (c) => !usedHeaders.has(c.raw) && (c.norm === field.label.toLowerCase() || field.aliases.includes(c.norm))
    );
    if (match) {
      mapping[field.key] = match.raw;
      usedHeaders.add(match.raw);
    }
  }
  return mapping;
}

const DEPARTMENT_ALIASES: Record<string, string> = {
  hr: 'Human Resources',
  'h.r.': 'Human Resources',
  'h r': 'Human Resources',
  'human resources': 'Human Resources',
  'people ops': 'Human Resources',
  'people operations': 'Human Resources',
  ops: 'Operations',
  operation: 'Operations',
  operations: 'Operations',
  fin: 'Finance',
  finance: 'Finance',
  accounting: 'Finance',
  sales: 'Sales',
  bd: 'Business Development',
  'business development': 'Business Development',
  tech: 'Technology Recruitment',
  technology: 'Technology Recruitment',
  'it recruitment': 'Technology Recruitment',
  'technology recruitment': 'Technology Recruitment',
  exec: 'Executive Search',
  'executive search': 'Executive Search',
  marketing: 'Marketing',
  legal: 'Legal & Compliance',
  compliance: 'Legal & Compliance',
  'legal & compliance': 'Legal & Compliance',
  perm: 'Permanent Recruitment',
  'permanent recruitment': 'Permanent Recruitment',
  contract: 'Contract & Interim',
  interim: 'Contract & Interim',
};

const WORK_STATUS_ALIASES: Record<string, WorkStatus> = {
  present: 'Present',
  'in office': 'Present',
  office: 'Present',
  attending: 'Present',
  onsite: 'Present',
  'on-site': 'Present',
  'on site': 'Present',
  active: 'Present',
  remote: 'Remote',
  wfh: 'Remote',
  home: 'Remote',
  'working from home': 'Remote',
  'work from home': 'Remote',
  telework: 'Remote',
  leave: 'Leave',
  'on leave': 'Leave',
  holiday: 'Leave',
  'annual leave': 'Leave',
  sick: 'Leave',
  'sick leave': 'Leave',
  pto: 'Leave',
  vacation: 'Leave',
  absent: 'Absent',
  'no show': 'Absent',
  'no-show': 'Absent',
  missing: 'Absent',
  unauthorised: 'Absent',
  unauthorized: 'Absent',
  away: 'Absent',
};

const WORK_ARRANGEMENT_ALIASES: Record<string, WorkArrangement> = {
  office: 'Office',
  'in office': 'Office',
  onsite: 'Office',
  'on-site': 'Office',
  remote: 'Remote',
  'fully remote': 'Remote',
  home: 'Remote',
  hybrid: 'Hybrid',
  flexible: 'Hybrid',
};

const WORKLOAD_ALIASES: Record<string, WorkloadLevel> = {
  low: 'Low',
  light: 'Low',
  underloaded: 'Low',
  medium: 'Medium',
  moderate: 'Medium',
  normal: 'Medium',
  balanced: 'Medium',
  high: 'High',
  heavy: 'High',
  overloaded: 'High',
  excessive: 'High',
  critical: 'High',
};

const ATTENTION_ALIASES: Record<string, AttentionStatus> = {
  'needs attention': 'Needs Attention',
  'need attention': 'Needs Attention',
  attention: 'Needs Attention',
  flagged: 'Needs Attention',
  yes: 'Needs Attention',
  true: 'Needs Attention',
  '1': 'Needs Attention',
  review: 'Needs Attention',
  ok: 'OK',
  okay: 'OK',
  normal: 'OK',
  no: 'OK',
  false: 'OK',
  '0': 'OK',
  clear: 'OK',
  none: 'OK',
};

const JOB_LEVEL_ALIASES: Record<string, string> = {
  grad: 'Graduate',
  graduate: 'Graduate',
  trainee: 'Graduate',
  jr: 'Junior',
  junior: 'Junior',
  associate: 'Junior',
  consultant: 'Consultant',
  'recruitment consultant': 'Consultant',
  'sr consultant': 'Senior Consultant',
  'snr consultant': 'Senior Consultant',
  'senior consultant': 'Senior Consultant',
  principal: 'Principal Consultant',
  'principal consultant': 'Principal Consultant',
  mgr: 'Manager',
  manager: 'Manager',
  'team lead': 'Manager',
  director: 'Director',
  vp: 'Director',
};

export function standardiseDepartment(raw: string): { value: string; changed: boolean } {
  const cleaned = cleanText(raw);
  if (!cleaned) return { value: '', changed: false };
  const key = cleaned.toLowerCase();
  if (DEPARTMENT_ALIASES[key]) {
    const val = DEPARTMENT_ALIASES[key];
    return { value: val, changed: val !== cleaned };
  }
  const titled = toTitleCase(cleaned);
  return { value: titled, changed: titled !== cleaned };
}

export function standardiseLocation(raw: string): { value: string; changed: boolean } {
  const cleaned = cleanText(raw);
  if (!cleaned) return { value: '', changed: false };
  const lower = cleaned.toLowerCase();
  const knownUkCities: Record<string, string> = {
    ldn: 'London',
    london: 'London',
    mcr: 'Manchester',
    manchester: 'Manchester',
    bham: 'Birmingham',
    birmingham: 'Birmingham',
    leeds: 'Leeds',
    edinburgh: 'Edinburgh',
    bristol: 'Bristol',
    glasgow: 'Glasgow',
    reading: 'Reading',
  };
  if (knownUkCities[lower]) {
    const val = knownUkCities[lower];
    return { value: val, changed: val !== cleaned };
  }
  for (const city of Object.values(knownUkCities)) {
    if (city.length >= 5 && levenshtein(lower, city.toLowerCase()) <= 2) {
      return { value: city, changed: city !== cleaned };
    }
  }
  const titled = toTitleCase(cleaned);
  return { value: titled, changed: titled !== cleaned };
}

export function standardiseJobLevel(raw: string): { value: string; changed: boolean } {
  const cleaned = cleanText(raw);
  if (!cleaned) return { value: 'Consultant', changed: true };
  const lower = cleaned.toLowerCase();
  if (JOB_LEVEL_ALIASES[lower]) {
    const val = JOB_LEVEL_ALIASES[lower];
    return { value: val, changed: val !== cleaned };
  }
  for (const canonical of Object.values(JOB_LEVEL_ALIASES)) {
    if (canonical.length >= 6 && levenshtein(lower, canonical.toLowerCase()) <= 2) {
      return { value: canonical, changed: canonical !== cleaned };
    }
  }
  const titled = toTitleCase(cleaned);
  return { value: titled, changed: titled !== cleaned };
}

export function standardiseWorkStatus(
  raw: string,
  customAliases: Record<string, WorkStatus> = {}
): { value: WorkStatus; changed: boolean; unmapped: boolean } {
  const cleaned = cleanText(raw);
  if (!cleaned) return { value: 'Unmapped', changed: true, unmapped: true };
  const lower = cleaned.toLowerCase();
  if (customAliases[lower]) {
    const val = customAliases[lower];
    return { value: val, changed: val !== cleaned, unmapped: false };
  }
  if (WORK_STATUS_ALIASES[lower]) {
    const val = WORK_STATUS_ALIASES[lower];
    return { value: val, changed: val !== cleaned, unmapped: false };
  }
  const canonicalStatuses: WorkStatus[] = ['Present', 'Remote', 'Leave', 'Absent'];
  for (const s of canonicalStatuses) {
    if (s.length >= 5 && levenshtein(lower, s.toLowerCase()) <= 2) {
      return { value: s, changed: s !== cleaned, unmapped: false };
    }
  }
  return { value: 'Unmapped', changed: true, unmapped: true };
}

export function standardiseWorkArrangement(raw: string): { value: WorkArrangement; changed: boolean } {
  const cleaned = cleanText(raw);
  if (!cleaned) return { value: 'Unspecified', changed: false };
  const lower = cleaned.toLowerCase();
  if (WORK_ARRANGEMENT_ALIASES[lower]) {
    const val = WORK_ARRANGEMENT_ALIASES[lower];
    return { value: val, changed: val !== cleaned };
  }
  for (const canonical of ['Office', 'Remote', 'Hybrid'] as const) {
    if (levenshtein(lower, canonical.toLowerCase()) <= 2) {
      return { value: canonical, changed: canonical !== cleaned };
    }
  }
  return { value: 'Unspecified', changed: true };
}

export function standardiseWorkloadLevel(raw: string): { value: WorkloadLevel; changed: boolean; valid: boolean } {
  const cleaned = cleanText(raw);
  const lower = cleaned.toLowerCase();
  if (WORKLOAD_ALIASES[lower]) {
    const val = WORKLOAD_ALIASES[lower];
    return { value: val, changed: val !== cleaned, valid: true };
  }
  for (const canonical of ['Low', 'Medium', 'High'] as const) {
    if (canonical.length >= 4 && levenshtein(lower, canonical.toLowerCase()) <= 1) {
      return { value: canonical, changed: canonical !== cleaned, valid: true };
    }
  }
  return { value: 'Medium', changed: true, valid: false };
}

export function standardiseAttentionStatus(raw: string): { value: AttentionStatus; changed: boolean } {
  const cleaned = cleanText(raw);
  const lower = cleaned.toLowerCase();
  if (ATTENTION_ALIASES[lower]) {
    const val = ATTENTION_ALIASES[lower];
    return { value: val, changed: val !== cleaned };
  }
  if (lower.includes('attention') || lower.includes('flag')) {
    return { value: 'Needs Attention', changed: cleaned !== 'Needs Attention' };
  }
  return { value: 'OK', changed: cleaned !== 'OK' };
}

export function parseExitTarget(raw: unknown): boolean | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = cleanText(raw).toLowerCase();
  if (!s || s === 'no' || s === 'false' || s === '0' || s === 'active' || s === 'stayed') return false;
  if (s === 'yes' || s === 'true' || s === '1' || s === 'left' || s === 'leaver' || s === 'exited') return true;
  // If it looks like an exit date (YYYY-MM-DD or DD/MM/YYYY), treat presence of date as leaver
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return true;
  return undefined;
}
