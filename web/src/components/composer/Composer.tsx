import { forwardRef, memo, useImperativeHandle, useMemo, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentTaskMode } from "../../types";
import type { MentionableAgent } from "../../lib/agentDisplayNames";
import { sendShortcutLabel } from "../../lib/sendShortcut";
import { ActionSend, ActionStop } from "../icons";
import { ModeToggle } from "./ModeToggle";
import { MentionPopover } from "./MentionPopover";
import { useComposer } from "../../hooks/useComposer";
import { boundedMentionIndex, mentionOptionId, nextMentionIndex } from "../../lib/mentions";


export type ComposerHandle = {
  clear: () => void;
  closeMentions: () => void;
  focus: () => void;
  getMentionedAgentId: () => string | null;
  getText: () => string;
};

// Message composer: textarea with @mention autocomplete, mode toggle, and the
// send/cancel control. Draft state stays inside this component so every
// keystroke does not re-render the full application shell and transcript.
const ComposerView = forwardRef<ComposerHandle, {
  mentionAgents: MentionableAgent[];
  composerMode: AgentTaskMode;
  setComposerMode: Dispatch<SetStateAction<AgentTaskMode>>;
  activeAgentDisplayName: string;
  selectedEmployee: string;
  running: boolean;
  onSend: () => void;
  onCancelRun: () => void;
}>(function Composer({ mentionAgents, composerMode, setComposerMode, activeAgentDisplayName, selectedEmployee, running, onSend, onCancelRun }, ref) {
  const { t } = useTranslation();
  const composer = useComposer({ mentionAgents });
  const {
    composerText, setComposerText, mentionOpen, setMentionOpen, mentionIndex, setMentionIndex,
    setIsComposing, textareaRef, filteredMentionAgents, syncMentionState, insertMention,
    getMentionedAgentId, clearMentionedAgent,
  } = composer;
  const hasMentionOptions = mentionOpen && filteredMentionAgents.length > 0;
  const activeMentionIndex = boundedMentionIndex(mentionIndex, filteredMentionAgents.length);
  const sendShortcutTitle = useMemo(
    () => t("composer.send_shortcut", { shortcut: sendShortcutLabel() }),
    [t],
  );

  useImperativeHandle(ref, () => ({
    clear: () => {
      setComposerText("");
      setMentionOpen(false);
      clearMentionedAgent();
    },
    closeMentions: () => setMentionOpen(false),
    focus: () => textareaRef.current?.focus(),
    getMentionedAgentId,
    getText: () => composerText,
  }), [clearMentionedAgent, composerText, getMentionedAgentId, setComposerText, setMentionOpen, textareaRef]);

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); if (!running) onSend(); }}>
      <div className="composer-input-wrap" data-running={running || undefined}>
        {hasMentionOptions ? (
          <MentionPopover
            filteredAgents={filteredMentionAgents}
            mentionIndex={activeMentionIndex}
            insertMention={insertMention}
          />
        ) : null}
        <div className="composer-input">
          <textarea
            ref={textareaRef}
            role="combobox"
            aria-autocomplete="list"
            aria-label={selectedEmployee
              ? t("composer.aria_label", { employee: selectedEmployee, agent: activeAgentDisplayName })
              : t("composer.aria_label_no_employee", { agent: activeAgentDisplayName })}
            aria-controls={hasMentionOptions ? "mention-popover" : undefined}
            aria-expanded={hasMentionOptions}
            aria-activedescendant={hasMentionOptions ? mentionOptionId(activeMentionIndex) : undefined}
            autoComplete="off"
            name="message"
            placeholder={selectedEmployee
              ? t("composer.placeholder")
              : t("composer.placeholder_no_employee")}
            value={composerText}
            onChange={(e) => {
              setComposerText(e.target.value);
              syncMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
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
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!running) onSend(); }
            }}
            rows={1}
          />
          <div className="composer-footer">
            <div className="composer-footer-left">
              <ModeToggle mode={composerMode} setMode={setComposerMode} />
            </div>
            <div className="composer-footer-right">
              {/* One mounted element for send↔stop so keyboard focus survives
                  the run starting; the glyph cross-fades instead. */}
              <button
                type={running ? "button" : "submit"}
                className={running ? "send-button send-button-cancel" : "send-button"}
                disabled={!running && !composerText.trim()}
                onClick={running ? onCancelRun : undefined}
                aria-label={running ? t("composer.cancel_run") : t("composer.send")}
                title={running ? t("composer.cancel_run") : sendShortcutTitle}
              >
                <span className="send-button-icon" key={running ? "stop" : "send"}>
                  {running ? <ActionStop size={16} /> : <ActionSend size={16} />}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
});

export const Composer = memo(ComposerView);
