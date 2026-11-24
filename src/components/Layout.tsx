import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  Users,
  BarChart3,
  ShieldAlert,
  Lightbulb,
  MessageSquare,
  FileText,
  Database,
  Settings,
  Search,
  Eye,
  EyeOff,
  Bot,
  AlertTriangle,
} from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { formatUkDate } from '../lib/clean/dates';
import { AssistantSideDrawer } from './AssistantPanel';
import { GuidedTourModal, HelpMenuButton, ShortcutsModal } from './GuidedTour';

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/employees', label: 'Employees', icon: Users },
  { to: '/dashboard', label: 'Executive Dashboard', icon: BarChart3 },
  { to: '/risk', label: 'Risk and Models', icon: ShieldAlert },
  { to: '/recommendations', label: 'Recommendations', icon: Lightbulb },
  { to: '/assistant', label: 'AI Assistant', icon: MessageSquare },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/data', label: 'Data and Uploads', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    activeSnapshot,
    inMemoryFallback,
    privacyMode,
    setPrivacyMode,
    filters,
    setFilters,
    setAssistantDrawerOpen,
    toasts,
  } = useWorkforce();
  const location = useLocation();
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Keyboard shortcuts: /, g then h, g then e, ?
  useEffect(() => {
    let gPressedAt = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if (e.key === 'Escape') {
        setShortcutsOpen(false);
        setAssistantDrawerOpen(false);
        return;
      }

      if (isTyping) return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key.toLowerCase() === 'g') {
        gPressedAt = Date.now();
      } else if (e.key.toLowerCase() === 'h' && Date.now() - gPressedAt < 900) {
        navigate('/');
      } else if (e.key.toLowerCase() === 'e' && Date.now() - gPressedAt < 900) {
        navigate('/employees');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, setAssistantDrawerOpen]);

  const currentNav = NAV_ITEMS.find((n) => n.to === location.pathname) ?? NAV_ITEMS[0];

  return (
    <div className="min-h-screen flex bg-[var(--cream)] text-[var(--brown)]">
      {/* Fixed Left Sidebar (desktop full, tablet icon-only, hidden on <640px) */}
      <aside
        aria-label="Primary navigation"
        className="hidden sm:flex flex-col fixed inset-y-0 left-0 z-30 w-16 lg:w-60 bg-[var(--brown)] text-[var(--cream)] border-r border-[var(--brown)] no-print"
      >
        <div className="px-3 lg:px-5 py-4 border-b border-[var(--cream)]/15 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--amber)] text-[var(--ink-on-amber)] font-bold text-sm flex items-center justify-center shrink-0">
            HR
          </div>
          <div className="hidden lg:block min-w-0">
            <p className="text-sm font-semibold leading-tight text-[var(--cream)] truncate">
              Hay Recruitment
            </p>
            <p className="text-[11px] text-[var(--cream)]/75 truncate">
              Workforce AI Central
            </p>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                title={item.label}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-2.5 lg:px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] font-semibold'
                      : 'text-[var(--cream)]/90 hover:bg-[var(--cream)]/10'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden lg:inline truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="hidden lg:block px-4 py-3 border-t border-[var(--cream)]/15 text-[11px] text-[var(--cream)]/75">
          UK GDPR Privacy Protected
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col sm:pl-16 lg:pl-60 min-w-0 pb-16 sm:pb-0">
        {/* Top Bar */}
        <header className="bg-[var(--surface)] border-b border-[var(--border)] px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <nav aria-label="Breadcrumb" className="text-xs text-[var(--muted)] flex items-center gap-1.5 whitespace-nowrap">
              <NavLink to="/" className="hover:text-[var(--brown)]">
                Hay Central
              </NavLink>
              <span aria-hidden="true">/</span>
              <span className="font-semibold text-[var(--brown)]">{currentNav.label}</span>
            </nav>

            {activeSnapshot && (
              <span className="hidden md:inline text-xs text-[var(--muted)] truncate">
                · Data uploaded {formatUkDate(activeSnapshot.uploadedAt.slice(0, 10))},{' '}
                <span className="tabular-nums">{activeSnapshot.rowCount.toLocaleString()}</span> employees, source{' '}
                {activeSnapshot.fileName}
              </span>
            )}

            {activeSnapshot?.isDemo && (
              <span className="px-2 py-0.5 rounded bg-[var(--amber-tint)] border border-[var(--amber)] text-[11px] font-semibold text-[var(--ink-on-amber)] whitespace-nowrap">
                Demo data
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="relative hidden sm:block">
              <Search className="w-3.5 h-3.5 text-[var(--muted)] absolute left-2.5 top-2.5" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                value={filters.search}
                onChange={(e) => {
                  setFilters((p) => ({ ...p, search: e.target.value }));
                }}
                placeholder="Search ID, name, dept (/)"
                aria-label="Global workforce search"
                className="h-8 w-44 lg:w-56 pl-8 pr-2.5 rounded-lg border border-[var(--border)] bg-[var(--cream)]/40 text-xs text-[var(--brown)]"
              />
            </div>

            <button
              type="button"
              onClick={() => setPrivacyMode(!privacyMode)}
              aria-pressed={privacyMode}
              className={`h-8 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                privacyMode
                  ? 'bg-[var(--brown)] text-[var(--cream)] border-[var(--brown)]'
                  : 'bg-[var(--surface)] text-[var(--brown)] border-[var(--border)] hover:bg-[var(--cream)]'
              }`}
              title="Mask employee names everywhere including exports and AI requests"
            >
              {privacyMode ? (
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span className="hidden md:inline">Privacy Mode</span>
            </button>

            <HelpMenuButton onShowShortcuts={() => setShortcutsOpen(true)} />
          </div>
        </header>

        {inMemoryFallback && (
          <div className="bg-[var(--sienna-tint)] border-b border-[var(--risk-high)] px-4 lg:px-6 py-2 text-xs text-[var(--risk-high)] flex items-center gap-2 no-print">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              IndexedDB storage is unavailable in this browser context. Running in temporary in-memory mode — uploaded data will not persist after reload.
            </span>
          </div>
        )}

        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {/* Mobile Bottom Navigation (<640px) */}
      <nav
        aria-label="Mobile navigation"
        className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-[var(--brown)] text-[var(--cream)] border-t border-[var(--cream)]/20 flex items-center justify-around py-1.5 px-1 no-print"
      >
        {NAV_ITEMS.slice(0, 5).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-2 py-1 rounded text-[10px] ${
                  isActive ? 'text-[var(--amber)] font-semibold' : 'text-[var(--cream)]/85'
                }`
              }
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span>{item.label.split(' ')[0]}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Floating AI Assistant Trigger */}
      {location.pathname !== '/assistant' && (
        <button
          type="button"
          onClick={() => setAssistantDrawerOpen(true)}
          aria-label="Open AI Workforce Assistant"
          className="floating-assistant-trigger fixed bottom-20 sm:bottom-5 right-5 z-30 h-11 px-4 rounded-full bg-[var(--amber)] text-[var(--ink-on-amber)] font-semibold text-xs border border-[var(--brown)]/20 inline-flex items-center gap-2 shadow-sm hover:brightness-95 transition-all no-print"
        >
          <Bot className="w-4 h-4" aria-hidden="true" />
          <span>AI Assistant</span>
        </button>
      )}

      <AssistantSideDrawer />
      <GuidedTourModal />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Toast Stack */}
      <div className="fixed bottom-4 left-4 sm:left-20 lg:left-64 z-50 flex flex-col gap-2 max-w-sm no-print" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-3.5 py-2.5 rounded-lg border text-xs font-medium shadow-sm ${
              t.tone === 'error'
                ? 'bg-[var(--oxblood-tint)] border-[var(--risk-critical)] text-[var(--risk-critical)]'
                : t.tone === 'warning'
                ? 'bg-[var(--amber-tint)] border-[var(--amber)] text-[var(--ink-on-amber)]'
                : 'bg-[var(--surface)] border-[var(--border)] text-[var(--brown)]'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
};
