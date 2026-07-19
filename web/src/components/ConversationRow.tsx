import { ActionEdit, ActionRemove } from "./icons";
import { useTranslation } from "react-i18next";
import { useDialogs } from "./ui/DialogProvider";
import type { RelaySession } from "../types";
import { conversationLabel, type ConversationItem } from "../lib/conversations";
import { Button } from "./ui/button";

export type { ConversationItem };

function relativeTime(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.round(diff / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  if (sec < 60) return formatter.format(-sec, "second");
  const min = Math.round(sec / 60);
  if (min < 60) return formatter.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return formatter.format(-hr, "hour");
  const day = Math.round(hr / 24);
  if (day < 7) return formatter.format(-day, "day");
  const wk = Math.round(day / 7);
  if (wk < 5) return formatter.format(-wk, "week");
  const mo = Math.round(day / 30);
  if (mo < 12) return formatter.format(-mo, "month");
  return formatter.format(-Math.round(day / 365), "year");
}

type ConversationRowProps = {
  item: ConversationItem;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  onRename?: (session: RelaySession) => void;
  onClose?: (sessionId: string) => void;
};

export function ConversationRow({ item, selected, onSelect, onRename, onClose }: ConversationRowProps) {
  const { t, i18n } = useTranslation();
  const { confirm } = useDialogs();
  const { session } = item;
  const label = conversationLabel(session);
  const stamp = relativeTime(session.updatedAt, i18n.language);
  const rowLabel = [label, stamp].filter(Boolean).join(" · ");

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
    <div className={`conversation-row ${selected ? "active" : ""}`.trimEnd()}>
      <Button variant="ghost"
        className="conversation-row-inner"
        type="button"
        aria-label={rowLabel}
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
      </Button>
      <span className="conversation-row-actions">
        {onRename ? (
          <Button variant="ghost"
            className="conversation-rename-btn"
            type="button"
            aria-label={t("conversation.rename")}
            title={t("conversation.rename")}
            onClick={() => onRename(session)}
          >
            <ActionEdit size={11} />
          </Button>
        ) : null}
        {onClose ? (
          <Button variant="ghost"
            className="conversation-remove-btn"
            type="button"
            aria-label={t("conversation.close")}
            title={t("conversation.close")}
            onClick={handleClose}
          >
            <ActionRemove size={11} />
          </Button>
        ) : null}
      </span>
    </div>
  );
}
