import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Home,
  Building2,
  UserX,
  Flame,
  TrendingDown,
  Layers,
  CalendarClock,
  ShieldAlert,
} from 'lucide-react';
import type {
  AttentionStatus,
  RiskBand,
  SignalCode,
  WorkStatus,
  WorkloadLevel,
} from '../types/workforce';

export const WorkStatusChip: React.FC<{ status: WorkStatus }> = ({ status }) => {
  if (status === 'Present') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-[var(--olive-tint)] text-[var(--olive-text)] border border-[var(--olive)]/30 whitespace-nowrap">
        <Building2 className="w-3 h-3 shrink-0" aria-hidden="true" />
        Present
      </span>
    );
  }
  if (status === 'Remote') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-[var(--amber-tint)] text-[var(--ink-on-amber)] border border-[var(--amber)]/40 whitespace-nowrap">
        <Home className="w-3 h-3 shrink-0" aria-hidden="true" />
        Remote
      </span>
    );
  }
  if (status === 'Leave') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium text-[var(--brown)] border border-[var(--brown)]/35 whitespace-nowrap leave-stripe-bg">
        <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="bg-[var(--surface)]/90 px-1 rounded">Leave</span>
      </span>
    );
  }
  if (status === 'Absent') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-[var(--sienna-tint)] text-[var(--risk-high)] border border-[var(--risk-high)]/35 whitespace-nowrap">
        <UserX className="w-3 h-3 shrink-0" aria-hidden="true" />
        Absent
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-[var(--oxblood-tint)] text-[var(--risk-critical)] border border-[var(--risk-critical)]/35 whitespace-nowrap">
      <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
      Unmapped
    </span>
  );
};

export const WorkloadChip: React.FC<{ level: WorkloadLevel }> = ({ level }) => {
  const style =
    level === 'High'
      ? 'bg-[var(--sienna-tint)] text-[var(--risk-high)] border-[var(--risk-high)]/35'
      : level === 'Medium'
      ? 'bg-[var(--amber-tint)] text-[var(--ink-on-amber)] border-[var(--amber)]/35'
      : 'bg-[var(--olive-tint)] text-[var(--olive-text)] border-[var(--olive)]/30';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium border whitespace-nowrap ${style}`}>
      {level}
    </span>
  );
};

export const AttentionChip: React.FC<{ status: AttentionStatus }> = ({ status }) => {
  if (status === 'Needs Attention') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold bg-[var(--risk-critical)] text-[var(--surface)] whitespace-nowrap">
        <ShieldAlert className="w-3 h-3 shrink-0" aria-hidden="true" />
        Needs Attention
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-[var(--olive-tint)] text-[var(--olive-text)] border border-[var(--olive)]/25 whitespace-nowrap">
      <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
      OK
    </span>
  );
};

export const RiskBandChip: React.FC<{ band: RiskBand; score?: number }> = ({ band, score }) => {
  const styles: Record<RiskBand, string> = {
    Low: 'bg-[var(--olive-tint)] text-[var(--olive-text)] border-[var(--olive)]/30',
    Medium: 'bg-[var(--amber-tint)] text-[var(--ink-on-amber)] border-[var(--amber)]/40',
    High: 'bg-[var(--sienna-tint)] text-[var(--risk-high)] border-[var(--risk-high)]/40',
    Critical: 'bg-[var(--risk-critical)] text-[var(--surface)] border-[var(--risk-critical)]',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold border tabular-nums whitespace-nowrap ${styles[band]}`}>
      {score !== undefined && <span>{score}</span>}
      <span>{band}</span>
    </span>
  );
};

export const SignalIconBadge: React.FC<{ code: SignalCode; title: string }> = ({ code, title }) => {
  const Icon =
    code === 'burnout_pattern'
      ? Flame
      : code.includes('engagement')
      ? TrendingDown
      : code.includes('workload') || code === 'severe_overload'
      ? Layers
      : code === 'stale_record' || code === 'unused_leave'
      ? CalendarClock
      : AlertTriangle;

  const tone =
    code === 'burnout_pattern' || code === 'critical_engagement' || code === 'severe_overload'
      ? 'text-[var(--risk-critical)] bg-[var(--oxblood-tint)]'
      : 'text-[var(--risk-high)] bg-[var(--sienna-tint)]';

  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${tone}`}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
    </span>
  );
};
