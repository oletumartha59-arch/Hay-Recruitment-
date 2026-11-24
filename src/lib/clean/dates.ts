import { cleanText } from './fuzzy';

export interface ParsedDateResult {
  iso: string | null;
  wasAmbiguous: boolean;
  isFuture: boolean;
  formatUsed: string;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export function parseUkDate(raw: unknown, referenceTodayIso?: string): ParsedDateResult {
  if (raw === null || raw === undefined || raw === '') {
    return { iso: null, wasAmbiguous: false, isFuture: false, formatUsed: 'empty' };
  }

  const todayIso = referenceTodayIso ?? new Date().toISOString().slice(0, 10);

  // Excel serial date (number or numeric string like 45678)
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d{5}(\.\d+)?$/.test(raw.trim()))) {
    const serial = typeof raw === 'number' ? raw : Number(raw.trim());
    if (serial > 10000 && serial < 90000) {
      // Excel epoch 1899-12-30
      const utcMs = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
      const dt = new Date(utcMs);
      const iso = dt.toISOString().slice(0, 10);
      return {
        iso,
        wasAmbiguous: false,
        isFuture: iso > todayIso,
        formatUsed: 'excel_serial',
      };
    }
  }

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const iso = raw.toISOString().slice(0, 10);
    return { iso, wasAmbiguous: false, isFuture: iso > todayIso, formatUsed: 'date_object' };
  }

  const s = cleanText(raw);

  // ISO YYYY-MM-DD (or with time)
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const iso = toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    return {
      iso,
      wasAmbiguous: false,
      isFuture: iso !== null && iso > todayIso,
      formatUsed: 'iso',
    };
  }

  // UK day-first DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const ukMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})(?:\s.*)?$/);
  if (ukMatch) {
    const first = Number(ukMatch[1]);
    const second = Number(ukMatch[2]);
    let year = Number(ukMatch[3]);
    if (year < 100) year += year >= 50 ? 1900 : 2000;

    // Day-first UK rule unless first > 12 or second > 12
    let day = first;
    let month = second;
    let wasAmbiguous = false;

    if (second > 12 && first <= 12) {
      // Unambiguously MM/DD/YYYY from an external export
      month = first;
      day = second;
    } else if (first <= 12 && second <= 12 && first !== second) {
      wasAmbiguous = true;
    }

    const iso = toIsoDate(year, month, day);
    return {
      iso,
      wasAmbiguous,
      isFuture: iso !== null && iso > todayIso,
      formatUsed: 'uk_day_first',
    };
  }

  // Text month e.g. "12 Jan 2025" or "12-Jan-2025"
  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6,
    jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const textMatch = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-,]+(\d{2,4})$/);
  if (textMatch) {
    const day = Number(textMatch[1]);
    const month = months[textMatch[2].toLowerCase()];
    let year = Number(textMatch[3]);
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    if (month) {
      const iso = toIsoDate(year, month, day);
      return {
        iso,
        wasAmbiguous: false,
        isFuture: iso !== null && iso > todayIso,
        formatUsed: 'text_month',
      };
    }
  }

  return { iso: null, wasAmbiguous: false, isFuture: false, formatUsed: 'invalid' };
}

export function diffDaysIso(laterIso: string, earlierIso: string): number {
  const a = Date.parse(`${laterIso}T00:00:00Z`);
  const b = Date.parse(`${earlierIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((a - b) / 86400000);
}

export function diffMonthsIso(laterIso: string, earlierIso: string): number {
  const a = new Date(`${laterIso}T00:00:00Z`);
  const b = new Date(`${earlierIso}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const months =
    (a.getUTCFullYear() - b.getUTCFullYear()) * 12 +
    (a.getUTCMonth() - b.getUTCMonth()) +
    (a.getUTCDate() - b.getUTCDate()) / 30.4375;
  return Math.max(0, Math.round(months * 10) / 10);
}

export function formatUkDate(iso: string): string {
  if (!iso) return 'n/a';
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatTenure(months: number): string {
  const total = Math.max(0, Math.round(months));
  const years = Math.floor(total / 12);
  const rem = total % 12;
  if (years === 0) return `${rem}m`;
  if (rem === 0) return `${years}y`;
  return `${years}y ${rem}m`;
}
