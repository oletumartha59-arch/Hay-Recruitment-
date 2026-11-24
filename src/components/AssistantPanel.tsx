import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Pin,
  Trash2,
  Table2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import {
  buildRuleBasedChatFallback,
  executeWorkforceTool,
  verifyAnswerNumbersAgainstTools,
  type ToolContext,
} from '../lib/ai/tools';
import type { ChatMessage } from '../types/workforce';
import { ChartCard } from './ChartCard';
import { BRAND_TOKENS } from '../theme/tokens';

const SUGGESTED_PROMPTS = [
  'How many employees are on leave in Manchester?',
  'Which department has the lowest average engagement?',
  'Who shows burnout signs but is not flagged as Needs Attention?',
  'Compare remote and office staff on engagement and overdue tasks.',
  'Show me pending tasks by department as a bar chart.',
  'What changed since the last upload?',
];

export const AssistantViewCore: React.FC<{ compact?: boolean; onClose?: () => void }> = ({
  compact = false,
  onClose,
}) => {
  const navigate = useNavigate();
  const {
    allEmployees,
    previousSnapshot,
    activeSnapshot,
    settings,
    privacyMode,
    activeModel,
    snapshots,
    chatHistory,
    appendChatMessage,
    clearChatHistory,
    aiServerAvailable,
    pushToast,
  } = useWorkforce();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [openDataIds, setOpenDataIds] = useState<Set<string>>(new Set());

  const toolCtx: ToolContext = useMemo(
    () => ({
      employees: allEmployees,
      previousEmployees: previousSnapshot?.employees,
      engagementScaleMax: activeSnapshot?.engagementScaleMax ?? 10,
      settings,
      privacyMode,
      includeNamesInAI: settings.includeNamesInAI,
      activeModel: activeModel ?? undefined,
      snapshots,
      onNavigateRecommendations: (scopeType, scopeId) => {
        navigate(`/recommendations?scopeType=${scopeType}&scopeId=${encodeURIComponent(scopeId)}`);
      },
      onTriggerExport: () => {
        navigate('/reports');
      },
    }),
    [allEmployees, previousSnapshot, activeSnapshot, settings, privacyMode, activeModel, snapshots, navigate]
  );

  const toggleShowData = (id: string) => {
    setOpenDataIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = async (promptText?: string) => {
    const q = (promptText ?? input).trim();
    if (!q || sending || allEmployees.length === 0) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: q,
      createdAt: new Date().toISOString(),
    };
    await appendChatMessage(userMsg);
    if (!promptText) setInput('');
    setSending(true);

    try {
      // Guardrail check before calling API
      if (/\b(age|race|religion|sex|gender|pregnant|pregnancy|disability|fire|dismiss|terminate)\b/i.test(q)) {
        const fb = buildRuleBasedChatFallback(q, toolCtx);
        await appendChatMessage({
          id: `asst_${Date.now()}`,
          role: 'assistant',
          text: fb.text,
          createdAt: new Date().toISOString(),
          toolsUsed: fb.toolsUsed,
          filterContext: `${allEmployees.length} employees`,
        });
        setSending(false);
        return;
      }

      if (!aiServerAvailable) {
        const fb = buildRuleBasedChatFallback(q, toolCtx);
        await appendChatMessage({
          id: `asst_${Date.now()}`,
          role: 'assistant',
          text: fb.text,
          createdAt: new Date().toISOString(),
          toolsUsed: fb.toolsUsed,
          filterContext: `Based on ${allEmployees.length} employees`,
          dataPayload: fb.dataPayload,
          aiFallback: true,
        });
        setSending(false);
        return;
      }

      const datasetMeta = {
        totalEmployees: allEmployees.length,
        departments: Array.from(new Set(allEmployees.map((e) => e.department))),
        locations: Array.from(new Set(allEmployees.map((e) => e.location))),
        hasExitColumn: allEmployees.some((e) => e.exitTarget !== undefined),
        privacyMode: privacyMode || !settings.includeNamesInAI,
        engagementScaleMax: activeSnapshot?.engagementScaleMax ?? 10,
      };

      const planRes = await fetch('/api/ai/chat/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          history: chatHistory.slice(-6).map((m) => ({ role: m.role, text: m.text })),
          datasetMeta,
          model: settings.geminiModel,
        }),
      });

      if (!planRes.ok) {
        throw new Error('AI planning request failed');
      }
      const planData = await planRes.json();
      const calls: Array<{ id?: string; name: string; args?: Record<string, unknown> }> =
        planData.functionCalls ?? [];

      if (calls.length === 0 && planData.text) {
        await appendChatMessage({
          id: `asst_${Date.now()}`,
          role: 'assistant',
          text: planData.text,
          createdAt: new Date().toISOString(),
          toolsUsed: [],
          filterContext: `Based on ${allEmployees.length} employees`,
        });
        setSending(false);
        return;
      }

      const executed = calls.map((c) => ({
        id: c.id,
        name: c.name,
        ...executeWorkforceTool(c.name, c.args ?? {}, toolCtx),
      }));

      const explainOnce = async (hint = '') => {
        const expRes = await fetch('/api/ai/chat/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q,
            history: chatHistory.slice(-6).map((m) => ({ role: m.role, text: m.text })),
            modelContent: planData.modelContent,
            toolResults: executed.map((e) => ({ id: e.id, name: e.name, result: e.result })),
            datasetMeta,
            strictRetryHint: hint,
            model: settings.geminiModel,
          }),
        });
        if (!expRes.ok) throw new Error('Explain call failed');
        return (await expRes.json()).text as string;
      };

      let answerText = await explainOnce();
      let check = verifyAnswerNumbersAgainstTools(
        answerText,
        executed.map((e) => e.result)
      );

      if (!check.valid) {
        answerText = await explainOnce(
          `Your previous draft contained unverified numbers (${check.ungroundedNumbers.join(', ')}). Use ONLY numbers present in the tool outputs.`
        );
        check = verifyAnswerNumbersAgainstTools(
          answerText,
          executed.map((e) => e.result)
        );
      }

      const primaryPayload = executed.find((e) => e.displayPayload)?.displayPayload;
      if (!check.valid) {
        // Show tool table only if post-check fails twice
        answerText =
          'Verified data from the workforce tools is shown below (AI narrative omitted because a figure could not be verified against the tool output).';
      }

      await appendChatMessage({
        id: `asst_${Date.now()}`,
        role: 'assistant',
        text: answerText,
        createdAt: new Date().toISOString(),
        toolsUsed: executed.map((e) => e.name),
        filterContext: `Based on ${allEmployees.length} employees`,
        dataPayload: primaryPayload,
      });
    } catch {
      const fb = buildRuleBasedChatFallback(q, toolCtx);
      await appendChatMessage({
        id: `asst_${Date.now()}`,
        role: 'assistant',
        text: fb.text,
        createdAt: new Date().toISOString(),
        toolsUsed: fb.toolsUsed,
        filterContext: `Based on ${allEmployees.length} employees`,
        dataPayload: fb.dataPayload,
        aiFallback: true,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="min-w-0">
          <h2 className="font-semibold text-sm text-[var(--brown)] truncate">
            Workforce AI Assistant
          </h2>
          <p className="text-[11px] text-[var(--muted)] truncate">
            {privacyMode || !settings.includeNamesInAI
              ? 'Privacy protected · Names masked in AI prompts'
              : 'Names included in AI requests (per Settings)'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {chatHistory.length > 0 && (
            <button
              type="button"
              onClick={clearChatHistory}
              className="btn-secondary px-2.5 py-1 text-xs inline-flex items-center gap-1"
              title="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              {!compact && <span>Clear</span>}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close AI assistant"
              className="w-7 h-7 rounded-md border border-[var(--border)] inline-flex items-center justify-center hover:bg-[var(--cream)]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {aiServerAvailable === false && (
        <div className="px-4 py-2 bg-[var(--amber-tint)] border-b border-[var(--amber)] text-[11px] text-[var(--ink-on-amber)] flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>
            AI explanation unavailable (Gemini API key not configured). Running deterministic workforce tools locally.
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {allEmployees.length === 0 ? (
          <div className="text-xs text-[var(--muted)] text-center py-8">
            Upload workforce data or load demo data to ask questions about your teams.
          </div>
        ) : chatHistory.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--muted)]">
              Ask any question about headcount, attendance, engagement, workload, warning signs, or changes since the last upload.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSend(p)}
                  className="text-left text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--cream)] text-[var(--brown)] transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chatHistory.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-1.5 ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[92%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[var(--brown)] text-[var(--cream)]'
                    : 'card-surface text-[var(--brown)]'
                }`}
              >
                {msg.aiFallback && (
                  <p className="text-[10px] font-semibold text-[var(--risk-high)] mb-1">
                    AI explanation unavailable — answered directly from deterministic tools
                  </p>
                )}
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {msg.role === 'assistant' && (
                  <div className="mt-2 pt-2 border-t border-[var(--border)]/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
                    <span>
                      {msg.filterContext}
                      {msg.toolsUsed && msg.toolsUsed.length > 0
                        ? ` · Tools: ${msg.toolsUsed.join(', ')}`
                        : ''}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {msg.dataPayload && (
                        <button
                          type="button"
                          onClick={() => toggleShowData(msg.id)}
                          className="px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--cream)]/50 text-[var(--brown)] inline-flex items-center gap-1 hover:bg-[var(--cream)]"
                        >
                          <Table2 className="w-3 h-3" aria-hidden="true" />
                          {openDataIds.has(msg.id) ? 'Hide data' : 'Show the data'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(msg.text);
                          pushToast('Copied answer to clipboard.', 'info');
                        }}
                        aria-label="Copy answer"
                        className="p-1 rounded hover:bg-[var(--cream)]"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          appendChatMessage({ ...msg, pinned: !msg.pinned })
                        }
                        aria-label="Pin insight"
                        className={`p-1 rounded hover:bg-[var(--cream)] ${
                          msg.pinned ? 'text-[var(--amber)]' : ''
                        }`}
                      >
                        <Pin className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          appendChatMessage({ ...msg, feedback: 'up' })
                        }
                        aria-label="Thumbs up"
                        className={`p-1 rounded hover:bg-[var(--cream)] ${
                          msg.feedback === 'up' ? 'text-[var(--olive-text)]' : ''
                        }`}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          appendChatMessage({ ...msg, feedback: 'down' })
                        }
                        aria-label="Thumbs down"
                        className={`p-1 rounded hover:bg-[var(--cream)] ${
                          msg.feedback === 'down' ? 'text-[var(--risk-high)]' : ''
                        }`}
                      >
                        <ThumbsDown className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {msg.role === 'assistant' && msg.dataPayload && openDataIds.has(msg.id) && (
                <div className="w-full max-w-[95%]">
                  {msg.dataPayload.type === 'chart' && msg.dataPayload.chartSpec ? (
                    <ChartCard
                      title={msg.dataPayload.chartSpec.title}
                      subtitle={msg.dataPayload.chartSpec.subtitle}
                      height={220}
                      summaryText={msg.dataPayload.chartSpec.title}
                      option={{
                        tooltip: { trigger: 'axis' },
                        grid: { left: 120, right: 24, top: 16, bottom: 24 },
                        xAxis: { type: 'value' },
                        yAxis: {
                          type: 'category',
                          data: [...msg.dataPayload.chartSpec.labels].reverse(),
                        },
                        series: [
                          {
                            type: 'bar',
                            data: [...msg.dataPayload.chartSpec.values].reverse(),
                            itemStyle: { color: BRAND_TOKENS.amber },
                            label: { show: true, position: 'right', color: BRAND_TOKENS.brown },
                          },
                        ],
                      }}
                    />
                  ) : (
                    msg.dataPayload.rows &&
                    msg.dataPayload.rows.length > 0 && (
                      <div className="card-surface p-2.5 overflow-x-auto">
                        <p className="text-[11px] font-semibold text-[var(--brown)] mb-1.5">
                          {msg.dataPayload.title}
                        </p>
                        <table className="w-full text-[11px] text-left border-collapse">
                          <thead>
                            <tr className="bg-[var(--cream)] text-[var(--brown)]">
                              {Object.keys(msg.dataPayload.rows[0]).map((col) => (
                                <th key={col} className="px-2 py-1 border-b border-[var(--border)] whitespace-nowrap">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {msg.dataPayload.rows.slice(0, 20).map((row, idx) => (
                              <tr key={idx} className="border-b border-[var(--border)]/50">
                                {Object.values(row).map((val, cIdx) => (
                                  <td key={cIdx} className="px-2 py-1 tabular-nums whitespace-nowrap">
                                    {String(val ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-3 border-t border-[var(--border)] bg-[var(--surface)] flex flex-col gap-1.5"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending || allEmployees.length === 0}
            placeholder={
              allEmployees.length === 0
                ? 'Load workforce data first...'
                : 'Ask about headcount, engagement, workload, or an employee ID...'
            }
            className="flex-1 h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--cream)]/30 text-xs text-[var(--brown)]"
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || allEmployees.length === 0}
            className="btn-primary h-9 px-3.5 text-xs inline-flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{sending ? 'Running...' : 'Ask'}</span>
          </button>
        </div>
        <p className="text-[10px] text-[var(--muted)]">
          AI explanations are decision support and may contain errors. Check the data shown.
        </p>
      </form>
    </div>
  );
};

export const AssistantSideDrawer: React.FC = () => {
  const { assistantDrawerOpen, setAssistantDrawerOpen } = useWorkforce();
  if (!assistantDrawerOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25 no-print" role="dialog" aria-modal="true" aria-label="AI Assistant Drawer">
      <div className="w-full max-w-md h-full bg-[var(--cream)] border-l border-[var(--border)]">
        <AssistantViewCore compact onClose={() => setAssistantDrawerOpen(false)} />
      </div>
    </div>
  );
};
