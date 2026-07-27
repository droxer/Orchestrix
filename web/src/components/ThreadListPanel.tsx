import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ActionCompose, ActionSearch } from "./icons";
import { ThreadRow, type ThreadItem } from "./ThreadRow";
import { groupThreads } from "../lib/threadGroups";
import type { RelaySession } from "../types";
import { Button } from "./ui/button";

// The logged-in employee's own threads. Each row is a session; the list
// is owner-scoped by the backend, so it only ever shows the current employee's
// work. “New thread” starts a fresh thread without archiving the rest.
export function ThreadListPanel({
  threads,
  query,
  setQuery,
  selectedSessionId,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onCloseThread,
}: {
  threads: ThreadItem[];
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  selectedSessionId: string | undefined;
  onSelectThread: (sessionId: string) => void;
  onNewThread: () => void;
  onRenameThread: (session: RelaySession) => void;
  onCloseThread: (sessionId: string) => void;
}) {
  const { t } = useTranslation();

  const groups = groupThreads(threads);
  const sections = [
    { key: "needsYou", tone: "attn", label: t("thread.group_needs_you"), items: groups.needsYou },
    { key: "running", tone: "run", label: t("thread.group_running"), items: groups.running },
    { key: "idle", tone: "idle", label: t("thread.group_idle"), items: groups.idle },
  ] as const;

  return (
    <aside id="thread-panel" className="thread-panel" aria-label={t("nav.threads")} tabIndex={-1}>
      <div className="conversation-header">
        <div className="conversation-heading">
          <h1>
            {t("nav.threads")}
            <small className="mono conversation-heading-count">
              {threads.length}
            </small>
          </h1>
        </div>
        <Button variant="ghost"
          type="button"
          className="conversation-new-btn"
          aria-label={t("thread.new_thread")}
          title={t("thread.new_thread")}
          onClick={onNewThread}
        >
          <ActionCompose size={16} />
        </Button>
      </div>
      <form className="relay-search conversation-search" onSubmit={(e) => e.preventDefault()}>
        <ActionSearch size={16} />
        <input
          aria-label={t("thread.search_label")}
          name="thread-search"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("thread.search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <section className="conversation-list" aria-label={t("nav.threads")}>
        {sections.map((section) =>
          section.items.length > 0 ? (
            <div key={section.key} className="conversation-group" data-tone={section.tone}>
              <div className="conversation-group-label">
                <span>{section.label}</span>
                <span className="conversation-group-count mono">{section.items.length}</span>
              </div>
              {section.items.map((item) => (
                <ThreadRow
                  key={item.session.id}
                  item={item}
                  selected={selectedSessionId === item.session.id}
                  onSelect={onSelectThread}
                  onRename={onRenameThread}
                  onClose={onCloseThread}
                />
              ))}
            </div>
          ) : null,
        )}
        {threads.length === 0 ? (
          <p className="conversation-empty">
            {query.trim() ? t("thread.no_matches") : t("thread.no_threads")}
          </p>
        ) : null}
      </section>
    </aside>
  );
}
