import { ActionRemove } from "./icons";
import { useTranslation } from "react-i18next";
import { useDialogs } from "./ui/DialogProvider";
import type { AgentName, RelaySession } from "../types";
import { conversationLabel } from "../lib/conversations";

// A conversation is one owner-scoped session. The row binds to the session
// itself (not an employee), so the logged-in employee can hold several in
// parallel and switch between them.
type ConversationItem = {
  session: RelaySession;
  /** Agent of an in-flight run for this conversation, if any. */
  runningAgent?: AgentName;
};

export type { ConversationItem };

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(day / 365)}y`;
}

type ConversationRowProps = {
  item: ConversationItem;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  onRename?: (session: RelaySession) => void;
  onClose?: (sessionId: string) => void;
};

export function ConversationRow({ item, selected, onSelect, onRename, onClose }: ConversationRowProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const { session, runningAgent } = item;
  const label = conversationLabel(session);
  const stamp = relativeTime(session.updatedAt);

  async function handleClose() {
    if (!onClose) return;
    const ok = await confirm({
      title: t("conversation.close_confirm", { name: label }),
      confirmLabel: t("conversation.close"),
      tone: "danger",
    });
    if (ok) onClose(session.id);
  }

  return (
    <div className={`conversation-row ${selected ? "active" : ""} ${runningAgent ? "has-activity" : ""}`}>
      <button
        className="conversation-row-inner"
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(session.id)}
      >
        <span className="conversation-copy">
          <span className="conversation-topline">
            <span className="conversation-name">
              <strong>{label}</strong>
            </span>
            {stamp ? (
              <span className="conversation-stamp mono">
                {stamp}
              </span>
            ) : null}
          </span>
        </span>
      </button>
      <span className="conversation-row-actions">
        {onRename ? (
          <button
            className="conversation-rename-btn"
            type="button"
            aria-label={t("conversation.rename")}
            title={t("conversation.rename")}
            onClick={() => onRename(session)}
          >
            <span aria-hidden="true">✎</span>
          </button>
        ) : null}
        {onClose ? (
          <button
            className="conversation-remove-btn"
            type="button"
            aria-label={t("conversation.close")}
            title={t("conversation.close")}
            onClick={handleClose}
          >
            <ActionRemove size={11} />
          </button>
        ) : null}
      </span>
    </div>
  );
}
