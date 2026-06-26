import { forwardRef, memo, useImperativeHandle, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, AgentTaskMode } from "../../types";
import { ActionSend, ActionStop } from "../icons";
import { ModeToggle } from "./ModeToggle";
import { MentionPopover } from "./MentionPopover";
import { useComposer } from "../../hooks/useComposer";
import { boundedMentionIndex, mentionOptionId, nextMentionIndex } from "../../lib/mentions";

export type ComposerHandle = {
  clear: () => void;
  closeMentions: () => void;
  focus: () => void;
  getText: () => string;
};

// Message composer: textarea with @mention autocomplete, mode toggle, and the
// send/cancel control. Draft state stays inside this component so every
// keystroke does not re-render the full application shell and transcript.
const ComposerView = forwardRef<ComposerHandle, {
  agentNames: AgentName[];
  disabledAgents?: AgentName[];
  composerMode: AgentTaskMode;
  setComposerMode: Dispatch<SetStateAction<AgentTaskMode>>;
  activeAgent: AgentName;
  selectedEmployee: string;
  running: boolean;
  onAgentPicked: (agent: AgentName) => void;
  onSend: () => void;
  onCancelRun: () => void;
}>(function Composer({ agentNames, disabledAgents, composerMode, setComposerMode, activeAgent, selectedEmployee, running, onAgentPicked, onSend, onCancelRun }, ref) {
  const { t } = useTranslation();
  const composer = useComposer({ agentNames, disabledAgents, onAgentPicked });
  const {
    composerText, setComposerText, mentionOpen, setMentionOpen, mentionIndex, setMentionIndex,
    setIsComposing, textareaRef, filteredMentionAgents, syncMentionState, insertMention,
  } = composer;
  const hasMentionOptions = mentionOpen && filteredMentionAgents.length > 0;
  const activeMentionIndex = boundedMentionIndex(mentionIndex, filteredMentionAgents.length);

  useImperativeHandle(ref, () => ({
    clear: () => {
      setComposerText("");
      setMentionOpen(false);
    },
    closeMentions: () => setMentionOpen(false),
    focus: () => textareaRef.current?.focus(),
    getText: () => composerText,
  }), [composerText, setComposerText, setMentionOpen, textareaRef]);

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
      <div className="composer-input-wrap">
        {hasMentionOptions ? <MentionPopover filteredAgents={filteredMentionAgents} mentionIndex={activeMentionIndex} insertMention={insertMention} /> : null}
        <div className="composer-input">
          <textarea
            ref={textareaRef}
            role="combobox"
            aria-autocomplete="list"
            aria-label={selectedEmployee
              ? t("composer.aria_label", { employee: selectedEmployee, agent: activeAgent })
              : t("composer.aria_label_no_employee", { agent: activeAgent })}
            aria-controls={hasMentionOptions ? "mention-popover" : undefined}
            aria-expanded={hasMentionOptions}
            aria-activedescendant={hasMentionOptions ? mentionOptionId(activeMentionIndex) : undefined}
            name="message"
            placeholder={selectedEmployee
              ? t("composer.placeholder")
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
                if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => nextMentionIndex(i, filteredMentionAgents.length, 1)); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => nextMentionIndex(i, filteredMentionAgents.length, -1)); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredMentionAgents[activeMentionIndex]); return; }
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
});

export const Composer = memo(ComposerView);
