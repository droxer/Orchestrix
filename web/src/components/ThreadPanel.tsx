import { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ActionCompose, ActionSearch } from "./icons";
import { ConversationRow, type ConversationItem } from "./ConversationRow";
import type { RelaySession } from "../types";

// The logged-in employee's own conversations. Each row is a session; the list
// is owner-scoped by the backend, so it only ever shows the current employee's
// work. "+ New conversation" starts a fresh thread without archiving the rest.
export function ThreadPanel({
  conversations,
  query,
  setQuery,
  selectedSessionId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onCloseConversation,
}: {
  conversations: ConversationItem[];
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  selectedSessionId: string | undefined;
  onSelectConversation: (sessionId: string) => void;
  onNewConversation: () => void;
  onRenameConversation: (session: RelaySession) => void;
  onCloseConversation: (sessionId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <aside className="thread-panel" aria-label={t("nav.conversations")}>
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
        <button
          type="button"
          className="conversation-new-btn"
          aria-label={t("conversation.new")}
          title={t("conversation.new")}
          onClick={onNewConversation}
        >
          <ActionCompose size={16} />
        </button>
      </div>
      <form className="people-search conversation-search" onSubmit={(e) => e.preventDefault()}>
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
        {conversations.map((item) => (
          <ConversationRow
            key={item.session.id}
            item={item}
            selected={selectedSessionId === item.session.id}
            onSelect={onSelectConversation}
            onRename={onRenameConversation}
            onClose={onCloseConversation}
          />
        ))}
        {conversations.length === 0 ? (
          <p className="conversation-empty">
            {query.trim() ? t("thread.no_matches") : t("thread.no_conversations")}
          </p>
        ) : null}
      </section>
    </aside>
  );
}
