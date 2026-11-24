import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpCircle, Keyboard, X } from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';

const TOUR_STEPS = [
  {
    title: '1. Upload & Clean Automatically',
    body: 'Upload Excel, CSV, TSV, JSON, or XML workforce exports. Columns auto-match, UK dates parse day-first, and every cleaning decision is logged before saving to IndexedDB.',
    route: '/data',
  },
  {
    title: '2. Cascading Filters & Privacy Mode',
    body: 'Filter by Department, Location, Work Status, Risk Band, or Warning Signals. Toggle Privacy Mode in the top bar at any time to mask employee names everywhere including exports.',
    route: '/employees',
  },
  {
    title: '3. Executive Dashboards',
    body: 'Explore Workforce Overview, Job Level breakdowns, Low Engagement signals, and Heavy Workload burnout quadrants. Click any chart bar or slice to cross-filter.',
    route: '/dashboard',
  },
  {
    title: '4. Risk Scoring & Honest Models',
    body: 'Without exit data, the transparent Retention Risk Index is active. With an exit target column (200+ rows, 30+ leavers), client-side ML models train and evaluate in a Web Worker.',
    route: '/risk',
  },
  {
    title: '5. AI Assistant & Retention Plans',
    body: 'Ask questions in plain English—TypeScript calculates exact numbers and Gemini explains them. Generate evidence-based P1/P2/P3 retention plans with manager 1:1 guides.',
    route: '/assistant',
  },
];

export const GuidedTourModal: React.FC = () => {
  const { tourOpen, setTourOpen, updateSettings, settings } = useWorkforce();
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);

  if (!tourOpen) return null;
  const current = TOUR_STEPS[stepIdx];

  const finish = () => {
    setTourOpen(false);
    setStepIdx(0);
    if (!settings.tourCompleted) {
      updateSettings({ tourCompleted: true });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 no-print" role="dialog" aria-modal="true" aria-label="Guided Tour">
      <div className="card-surface p-6 max-w-lg w-full flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--muted)]">
            Guided Tour · Step {stepIdx + 1} of {TOUR_STEPS.length}
          </span>
          <button
            type="button"
            onClick={finish}
            aria-label="Close tour"
            className="w-7 h-7 rounded-md border border-[var(--border)] inline-flex items-center justify-center hover:bg-[var(--cream)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <h3 className="font-page-title text-lg font-semibold text-[var(--brown)]">
          {current.title}
        </h3>
        <p className="text-sm text-[var(--brown)] leading-relaxed">{current.body}</p>

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => {
              navigate(current.route);
              finish();
            }}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            Jump to this page
          </button>
          <div className="flex items-center gap-2">
            {stepIdx > 0 && (
              <button
                type="button"
                onClick={() => setStepIdx((i) => i - 1)}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                Previous
              </button>
            )}
            {stepIdx < TOUR_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStepIdx((i) => i + 1)}
                className="btn-primary px-4 py-1.5 text-xs"
              >
                Next
              </button>
            ) : (
              <button type="button" onClick={finish} className="btn-primary px-4 py-1.5 text-xs">
                Finish tour
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const ShortcutsModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  if (!open) return null;
  const rows = [
    { key: '/', desc: 'Focus global employee search' },
    { key: 'g then h', desc: 'Go to Home page' },
    { key: 'g then e', desc: 'Go to Employees table' },
    { key: '?', desc: 'Show keyboard shortcuts' },
    { key: 'Esc', desc: 'Close open dialog or drawer' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 no-print" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="card-surface p-5 max-w-md w-full flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-[var(--brown)] inline-flex items-center gap-2">
            <Keyboard className="w-4 h-4" aria-hidden="true" />
            Keyboard Shortcuts
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="w-7 h-7 rounded-md border border-[var(--border)] inline-flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="divide-y divide-[var(--border)] text-xs">
          {rows.map((r) => (
            <div key={r.key} className="py-2 flex items-center justify-between">
              <span className="text-[var(--brown)]">{r.desc}</span>
              <kbd className="px-2 py-0.5 rounded bg-[var(--cream)] border border-[var(--border)] font-mono text-[11px]">
                {r.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const HelpMenuButton: React.FC<{ onShowShortcuts: () => void }> = ({
  onShowShortcuts,
}) => {
  const { setTourOpen } = useWorkforce();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Help and guided tour"
        className="h-8 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--cream)] inline-flex items-center gap-1.5 text-xs text-[var(--brown)]"
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden md:inline">Help</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-30 w-44 card-surface p-1 shadow-sm text-xs">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTourOpen(true);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--cream)] text-[var(--brown)]"
            >
              Replay guided tour
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onShowShortcuts();
              }}
              className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--cream)] text-[var(--brown)]"
            >
              Keyboard shortcuts (?)
            </button>
          </div>
        </>
      )}
    </div>
  );
};
