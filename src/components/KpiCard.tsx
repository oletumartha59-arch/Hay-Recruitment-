import React, { useState } from 'react';
import { Info } from 'lucide-react';

export interface KpiCardProps {
  label: string;
  value: string;
  secondaryLine?: string;
  deltaText?: string;
  deltaTone?: 'positive' | 'negative' | 'neutral';
  statusAccent?: 'olive' | 'amber' | 'leave' | 'sienna' | 'oxblood' | 'brown';
  formula: string;
  onClick?: () => void;
  active?: boolean;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  secondaryLine,
  deltaText,
  deltaTone = 'neutral',
  statusAccent = 'brown',
  formula,
  onClick,
  active = false,
}) => {
  const [showInfo, setShowInfo] = useState(false);

  const accentBarClass =
    statusAccent === 'olive'
      ? 'bg-[var(--olive)]'
      : statusAccent === 'amber'
      ? 'bg-[var(--amber)]'
      : statusAccent === 'leave'
      ? 'leave-stripe-bg border border-[var(--brown)]/40'
      : statusAccent === 'sienna'
      ? 'bg-[var(--risk-high)]'
      : statusAccent === 'oxblood'
      ? 'bg-[var(--risk-critical)]'
      : 'bg-[var(--brown)]';

  const deltaColor =
    deltaTone === 'positive'
      ? 'text-[var(--olive-text)]'
      : deltaTone === 'negative'
      ? 'text-[var(--risk-critical)]'
      : 'text-[var(--muted)]';

  return (
    <div
      className={`card-surface p-3.5 flex flex-col justify-between gap-2 relative transition-colors ${
        onClick ? 'cursor-pointer hover:bg-[var(--cream)]/40' : ''
      } ${active ? 'ring-2 ring-[var(--amber)]' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className={`w-1.5 h-4 rounded-sm shrink-0 ${accentBarClass}`}
          />
          <span className="text-xs font-medium text-[var(--muted)] truncate">
            {label}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowInfo((v) => !v);
          }}
          aria-label={`Formula for ${label}`}
          className="w-5 h-5 rounded inline-flex items-center justify-center text-[var(--muted)] hover:text-[var(--brown)] hover:bg-[var(--cream)] shrink-0 no-print"
        >
          <Info className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="text-[28px] font-semibold leading-tight text-[var(--brown)] tabular-nums">
        {value}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs min-h-[18px]">
        <span className="text-[var(--muted)] tabular-nums truncate">
          {secondaryLine ?? ''}
        </span>
        {deltaText && (
          <span className={`font-medium tabular-nums shrink-0 ${deltaColor}`}>
            {deltaText}
          </span>
        )}
      </div>

      {showInfo && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-2 right-2 top-10 z-20 card-surface p-2.5 text-xs text-[var(--brown)] shadow-sm"
        >
          <p className="font-semibold mb-0.5">Formula</p>
          <p className="text-[var(--muted)]">{formula}</p>
        </div>
      )}
    </div>
  );
};
