import { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ActionCompose, ActionSearch } from "./icons";
import { ConversationRow, type ConversationItem } from "./ConversationRow";
import { groupConversations } from "../lib/conversationGroups";
import type { RelaySession } from "../types";
import type { AgentName } from "../types";
import { Button } from "./ui/button";

// The logged-in employee's own conversations. Each row is a session; the list
// is owner-scoped by the backend, so it only ever shows the current employee's
// work. "+ New conversation" starts a fresh thread without archiving the rest.
export function ThreadPanel({
  conversations,
  query,
  setQuery,
  selectedSessionId,
  agentDisplayNames,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onCloseConversation,
}: {
  conversations: ConversationItem[];
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  selectedSessionId: string | undefined;
  agentDisplayNames?: Partial<Record<AgentName, string>>;
  onSelectConversation: (sessionId: string) => void;
  onNewConversation: () => void;
  onRenameConversation: (session: RelaySession) => void;
  onCloseConversation: (sessionId: string) => void;
}) {
  const { t } = useTranslation();

  const groups = groupConversations(conversations);
  const sections = [
    { key: "needsYou", tone: "attn", label: t("thread.group_needs_you"), items: groups.needsYou },
    { key: "running", tone: "run", label: t("thread.group_running"), items: groups.running },
    { key: "idle", tone: "idle", label: t("thread.group_idle"), items: groups.idle },
  ] as const;

  return (
    <aside id="thread-panel" className="thread-panel" aria-label={t("nav.conversations")} tabIndex={-1}>
      <div className="conversation-header">
        <div className="conversation-heading">
          <span className="conversation-heading-eyebrow">{t("nav.conversations")}</span>
          <h1>
            {t("thread.messages")}
            <small className="mono conversation-heading-count">
              {conversations.length.toString().padStart(2, "0")}
            </small>
          </h1>
        </div>
        <Button variant="ghost"
          type="button"
          className="conversation-new-btn"
          aria-label={t("thread.new_conversation")}
          title={t("thread.new_conversation")}
          onClick={onNewConversation}
        >
          <ActionCompose size={16} />
        </Button>
      </div>
      <form className="relay-search conversation-search" onSubmit={(e) => e.preventDefault()}>
        <ActionSearch size={16} />
        <input
          aria-label={t("thread.search_label")}
          name="conversation-search"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("thread.search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <section className="conversation-list" aria-label={t("nav.conversations")}>
        {sections.map((section) =>
          section.items.length > 0 ? (
            <div key={section.key} className="conversation-group" data-tone={section.tone}>
              <div className="conversation-group-label">
                <span>{section.label}</span>
                <span className="conversation-group-count mono">{section.items.length}</span>
              </div>
              {section.items.map((item) => (
                <ConversationRow
                  key={item.session.id}
                  item={item}
                  selected={selectedSessionId === item.session.id}
                  agentDisplayNames={agentDisplayNames}
                  onSelect={onSelectConversation}
                  onRename={onRenameConversation}
                  onClose={onCloseConversation}
                />
              ))}
            </div>
          ) : null,
        )}
        {conversations.length === 0 ? (
          <p className="conversation-empty">
            {query.trim() ? t("thread.no_matches") : t("thread.no_conversations")}
          </p>
        ) : null}
      </section>
    </aside>
  );
}
