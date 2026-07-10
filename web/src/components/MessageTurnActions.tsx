import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionCopy, ActionRetry, CheckIcon } from "./icons";
import type { AgentName, AgentTaskMode } from "../types";
import { agentMessagePlainText } from "../lib/agentStream";

type MessageTurnActionsProps = {
  agent: AgentName;
  mode: AgentTaskMode;
  stdout: string;
  stderr: string;
  streaming: boolean;
  retryDisabled?: boolean;
  onRetry?: (agent: AgentName, mode: AgentTaskMode) => void;
};

export function MessageTurnActions({
  agent,
  mode,
  stdout,
  stderr,
  streaming,
  retryDisabled = false,
  onRetry,
}: MessageTurnActionsProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const handleCopy = useCallback(async () => {
    const text = agentMessagePlainText(agent, stdout, stderr, t, streaming);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable — silently no-op
    }
  }, [agent, stdout, stderr, streaming, t]);

  const handleRetry = useCallback(() => {
    if (retryDisabled || streaming || !onRetry) return;
    onRetry(agent, mode);
  }, [agent, mode, onRetry, retryDisabled, streaming]);

  const canCopy = Boolean(agentMessagePlainText(agent, stdout, stderr, t, streaming));
  const showRetry = Boolean(onRetry) && !streaming;

  if (!canCopy && !showRetry) return null;

  return (
    <div className="msg-turn-actions" role="group" aria-label={t("message.actions_label")}>
      {canCopy ? (
        <button
          type="button"
          className={`msg-turn-action ${copied ? "is-copied" : ""}`}
          onClick={() => void handleCopy()}
          aria-label={copied ? t("message.copied") : t("message.copy")}
          title={copied ? t("message.copied") : t("message.copy")}
        >
          {copied ? <CheckIcon size={14} /> : <ActionCopy size={14} />}
          <span className="msg-turn-action-label">{copied ? t("message.copied") : t("message.copy")}</span>
        </button>
      ) : null}
      {showRetry ? (
        <button
          type="button"
          className="msg-turn-action"
          onClick={handleRetry}
          disabled={retryDisabled}
          aria-label={t("message.retry")}
          title={t("message.retry")}
        >
          <ActionRetry size={14} />
          <span className="msg-turn-action-label">{t("message.retry")}</span>
        </button>
      ) : null}
    </div>
  );
}
