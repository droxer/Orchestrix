import { ActionEdit, ActionRemove, NodeOffline } from "./icons";
import { useTranslation } from "react-i18next";
import type { RelaySession } from "../types";
import { canDeleteThread, threadLabel, type ThreadItem } from "../lib/threads";
import { Button } from "@/components/ui/button";

export type { ThreadItem };

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

type ThreadRowProps = {
  item: ThreadItem;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  onRename?: (session: RelaySession) => void;
  onClose?: (sessionId: string) => void;
};

export function ThreadRow({ item, selected, onSelect, onRename, onClose }: ThreadRowProps) {
  const { t, i18n } = useTranslation();
  const { session } = item;
  const label = threadLabel(session);
  const stamp = relativeTime(session.updatedAt, i18n.language);
  const offlineLabel = item.nodeOffline ? t("thread.node_offline") : "";
  const rowLabel = [label, offlineLabel, stamp].filter(Boolean).join(" · ");
  const deleteEnabled = canDeleteThread(item);

  function handleClose() {
    onClose?.(session.id);
  }

  return (
    <div className={`conversation-row ${selected ? "active" : ""}`.trimEnd()}>
      <Button variant="ghost"
        className="conversation-row-inner"
        type="button"
        aria-label={rowLabel}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(session.id)}
      >
        <span className="conversation-copy">
          <span className="conversation-topline">
            <span className="conversation-name">
              <strong>{label}</strong>
              {item.nodeOffline ? (
                <span
                  className="conversation-offline"
                  role="img"
                  aria-label={offlineLabel}
                  title={offlineLabel}
                >
                  <NodeOffline size={12} />
                </span>
              ) : null}
            </span>
            {stamp ? (
              <span className="conversation-stamp tnum">
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
            aria-label={t("thread.rename")}
            title={t("thread.rename")}
            onClick={() => onRename(session)}
          >
            <ActionEdit size={11} />
          </Button>
        ) : null}
        {onClose ? (
          <Button variant="ghost"
            className="conversation-remove-btn"
            type="button"
            aria-label={deleteEnabled ? t("thread.delete") : t("thread.delete_blocked")}
            title={deleteEnabled ? t("thread.delete") : t("thread.delete_blocked")}
            disabled={!deleteEnabled}
            onClick={handleClose}
          >
            <ActionRemove size={11} />
          </Button>
        ) : null}
      </span>
    </div>
  );
}
