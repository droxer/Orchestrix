import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActionCopy,
  ActionRetry,
  CheckIcon,
  ICON,
} from "./icons";
import type { AgentName } from "../types";
import { agentMessagePlainText } from "../lib/agentStream";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/DialogProvider";

type MessageTurnActionsProps = {
  agent: AgentName;
  /** Logical agent that produced the turn, so a retry goes back to it. */
  agentId?: string;
  stdout: string;
  stderr: string;
  streaming: boolean;
  retryDisabled?: boolean;
  onRetry?: (agent: AgentName, agentId?: string) => void;
};

export function MessageTurnActions({
  agent,
  agentId,
  stdout,
  stderr,
  streaming,
  retryDisabled = false,
  onRetry,
}: MessageTurnActionsProps) {
  const { t } = useTranslation();
  const { announce } = useDialogs();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  // Copy/retry actions are hidden while output streams, so defer the full
  // plain-text projection until the run settles instead of reparsing every
  // accumulated SSE update.
  const plainText = useMemo(
    () => streaming ? "" : agentMessagePlainText(agent, stdout, stderr, t),
    [agent, stdout, stderr, t, streaming],
  );

  const handleCopy = useCallback(async () => {
    if (!plainText) return;
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable (permissions, non-secure context) — tell the
      // user and give them the manual fallback.
      announce({ message: t("errors.copy_message"), tone: "error" });
    }
  }, [plainText, t, announce]);

  const handleRetry = useCallback(() => {
    if (retryDisabled || streaming || !onRetry) return;
    onRetry(agent, agentId);
  }, [agent, agentId, onRetry, retryDisabled, streaming]);

  const canCopy = Boolean(plainText);
  const showRetry = Boolean(onRetry) && !streaming;

  if (!canCopy && !showRetry) return null;

  return (
    <div className="msg-turn-actions" role="group" aria-label={t("message.actions_label")}>
      {/* The copied state swaps the button glyph only, so announce it here. */}
      <span className="sr-only" role="status">{copied ? t("message.copied") : ""}</span>
      {canCopy ? (
        <Button variant="ghost"
          type="button"
          className={`msg-turn-action ${copied ? "is-copied" : ""}`}
          onClick={() => void handleCopy()}
          aria-label={copied ? t("message.copied") : t("message.copy")}
          title={copied ? t("message.copied") : t("message.copy")}
        >
          {copied ? <CheckIcon size={ICON.sm} /> : <ActionCopy size={ICON.sm} />}
          <span className="msg-turn-action-label">{copied ? t("message.copied") : t("message.copy")}</span>
        </Button>
      ) : null}
      {showRetry ? (
        <Button variant="ghost"
          type="button"
          className="msg-turn-action"
          onClick={handleRetry}
          disabled={retryDisabled}
          aria-label={t("message.retry")}
          title={t("message.retry")}
        >
          <ActionRetry size={ICON.sm} />
          <span className="msg-turn-action-label">{t("message.retry")}</span>
        </Button>
      ) : null}
    </div>
  );
}
