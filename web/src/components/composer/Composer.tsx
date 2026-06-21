import { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, AgentTaskMode } from "../../types";
import { ActionSend, ActionStop } from "../icons";
import { ModeToggle } from "./ModeToggle";
import { MentionPopover } from "./MentionPopover";
import type { useComposer } from "../../hooks/useComposer";

// Message composer: textarea with @mention autocomplete, mode toggle, and the
// send/cancel control. Composer state lives in the host's useComposer bundle
// (passed via `composer`); submit/cancel are delegated to the host.
export function Composer({ composer, composerMode, setComposerMode, activeAgent, selectedEmployee, running, onSend, onCancelRun }: {
  composer: ReturnType<typeof useComposer>;
  composerMode: AgentTaskMode;
  setComposerMode: Dispatch<SetStateAction<AgentTaskMode>>;
  activeAgent: AgentName;
  selectedEmployee: string;
  running: boolean;
  onSend: () => void;
  onCancelRun: () => void;
}) {
  const { t } = useTranslation();
  const {
    composerText, setComposerText, mentionOpen, setMentionOpen, mentionIndex, setMentionIndex,
    setIsComposing, textareaRef, filteredMentionAgents, syncMentionState, insertMention,
  } = composer;

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
      <div className="composer-input-wrap">
        {mentionOpen && filteredMentionAgents.length > 0 ? <MentionPopover filteredAgents={filteredMentionAgents} mentionIndex={mentionIndex} insertMention={insertMention} /> : null}
        <div className="composer-input">
          <textarea
            ref={textareaRef}
            role="combobox"
            aria-autocomplete="list"
            aria-label={selectedEmployee
              ? t("composer.aria_label", { employee: selectedEmployee, agent: activeAgent })
              : t("composer.aria_label_no_employee", { agent: activeAgent })}
            aria-controls={mentionOpen ? "mention-popover" : undefined}
            aria-expanded={mentionOpen}
            aria-activedescendant={mentionOpen ? `mention-option-${mentionIndex}` : undefined}
            name="message"
            placeholder={selectedEmployee
              ? t("composer.placeholder", { employee: selectedEmployee })
              : t("composer.placeholder_no_employee")}
            value={composerText}
            onChange={(e) => { setComposerText(e.target.value); syncMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
            onKeyUp={(e) => { if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length); }}
            onSelect={(e) => syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={(e) => { setIsComposing(false); syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length); }}
            onBlur={() => setMentionOpen(false)}
            onKeyDown={(e) => {
              if (mentionOpen && filteredMentionAgents.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % filteredMentionAgents.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + filteredMentionAgents.length) % filteredMentionAgents.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredMentionAgents[mentionIndex]); return; }
                if (e.key === "Escape") { e.preventDefault(); setMentionOpen(false); return; }
              }
              if (e.key === "Tab" && e.shiftKey) {
                e.preventDefault();
                setComposerMode((m) => (m === "action" ? "review" : "action"));
                return;
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend(); }
            }}
            rows={2}
          />
          <div className="composer-footer">
            <div className="composer-footer-left">
              <ModeToggle mode={composerMode} setMode={setComposerMode} />
            </div>
            <div className="composer-footer-right">
              {running ? (
                <button
                  type="button"
                  className="send-button send-button-cancel"
                  onClick={onCancelRun}
                  aria-label={t("composer.cancel_run")}
                  title={t("composer.cancel_run")}
                >
                  <ActionStop size={16} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  disabled={!composerText.trim()}
                  aria-label={t("composer.send")}
                  title={`${t("composer.send")} (⌘↵)`}
                >
                  <ActionSend size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
