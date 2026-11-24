import React from 'react';
import { AssistantViewCore } from '../components/AssistantPanel';
import { useWorkforce } from '../app/WorkforceContext';
import { Pin } from 'lucide-react';

export const AssistantPage: React.FC = () => {
  const { chatHistory } = useWorkforce();
  const pinned = chatHistory.filter((m) => m.pinned);

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] w-full mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-76px)]">
      <div className="lg:col-span-2 card-surface overflow-hidden flex flex-col h-full min-h-[500px]">
        <AssistantViewCore />
      </div>

      <aside className="card-surface p-4 flex flex-col gap-3 overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2.5">
          <Pin className="w-4 h-4 text-[var(--amber)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--brown)]">
            Pinned Insights ({pinned.length})
          </h2>
        </div>

        {pinned.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">
            Click the pin icon on any AI Assistant response to keep key findings here for board packs and manager briefings.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {pinned.map((msg) => (
              <div
                key={msg.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/40 p-3 text-xs text-[var(--brown)]"
              >
                <p>{msg.text}</p>
                {msg.filterContext && (
                  <p className="text-[11px] text-[var(--muted)] mt-1">{msg.filterContext}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
};
