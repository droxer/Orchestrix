import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, AgentTaskMode, EmployeeAgent } from "../../types";
import type { MentionableAgent } from "../../lib/agentDisplayNames";
import { sendShortcutLabel } from "../../lib/sendShortcut";
import { isLogicalAgentRoutable } from "../../lib/agentDisplayNames";
import { ActionSend, ActionStop } from "../icons";
import { ModeToggle } from "./ModeToggle";
import { AgentSelect } from "./AgentSelect";
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
  activeAgent: AgentName;
  logicalAgents: EmployeeAgent[];
  activeLogicalAgentId: string | null;
  onLogicalAgentPicked: (agent: EmployeeAgent) => void;
  activeAgentDisplayName: string;
  selectedEmployee: string;
  running: boolean;
  onSend: () => void;
  onCancelRun: () => void;
}>(function Composer({ mentionAgents, composerMode, setComposerMode, activeAgent, logicalAgents, activeLogicalAgentId, onLogicalAgentPicked, activeAgentDisplayName, selectedEmployee, running, onSend, onCancelRun }, ref) {
  const { t } = useTranslation();
  const composer = useComposer({ mentionAgents });
  const {
    composerText, setComposerText, mentionOpen, setMentionOpen, mentionIndex, setMentionIndex,
    setIsComposing, textareaRef, filteredMentionAgents, syncMentionState, insertMention,
    getMentionedAgentId, clearMentionedAgent,
  } = composer;
  const hasMentionOptions = mentionOpen && filteredMentionAgents.length > 0;
  const activeMentionIndex = boundedMentionIndex(mentionIndex, filteredMentionAgents.length);
  // Picking an agent via @mention also selects it in the composer picker so
  // the footer select reflects where the message will go.
  const insertMentionAndSelect = (agent: MentionableAgent) => {
    insertMention(agent);
    const logicalAgent = logicalAgents.find((candidate) => candidate.id === agent.id);
    if (logicalAgent && isLogicalAgentRoutable(logicalAgent.availability)) onLogicalAgentPicked(logicalAgent);
  };
  const sendShortcutTitle = useMemo(
    () => t("composer.send_shortcut", { shortcut: sendShortcutLabel() }),
    [t],
  );

  // Interim state between submit and the run actually starting, so the send
  // button can't double-fire while the dispatch is still being validated.
  const [sendPending, setSendPending] = useState(false);
  const triggerSend = () => {
    if (running || sendPending) return;
    setSendPending(true);
    onSend();
  };
  useEffect(() => {
    if (!sendPending) return;
    if (running) {
      setSendPending(false);
      return;
    }
    // The run starting clears pending; if dispatch failed upstream (validation,
    // error toast) `running` never flips, so fall back to a timeout instead of
    // leaving the send button stuck disabled.
    const timer = setTimeout(() => setSendPending(false), 4000);
    return () => clearTimeout(timer);
  }, [sendPending, running]);

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
    <form className="composer" onSubmit={(e) => { e.preventDefault(); triggerSend(); }}>
      <div className="composer-input-wrap" data-running={running || undefined}>
        {hasMentionOptions ? (
          <MentionPopover
            filteredAgents={filteredMentionAgents}
            mentionIndex={activeMentionIndex}
            insertMention={insertMentionAndSelect}
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
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMentionAndSelect(filteredMentionAgents[activeMentionIndex]); return; }
                if (e.key === "Escape") { e.preventDefault(); setMentionOpen(false); return; }
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); triggerSend(); }
            }}
            rows={1}
          />
          <div className="composer-footer">
            <div className="composer-footer-left">
              <AgentSelect
                activeAgent={activeAgent}
                logicalAgents={logicalAgents}
                activeLogicalAgentId={activeLogicalAgentId}
                onLogicalAgentPicked={onLogicalAgentPicked}
              />
              <ModeToggle mode={composerMode} setMode={setComposerMode} />
            </div>
            <div className="composer-footer-right">
              {/* One mounted element for send↔stop so keyboard focus survives
                  the run starting; the glyph cross-fades instead. */}
              <button
                type={running ? "button" : "submit"}
                className={running ? "send-button send-button-cancel" : "send-button"}
                disabled={!running && (sendPending || !composerText.trim())}
                onClick={running ? onCancelRun : undefined}
                aria-busy={sendPending || undefined}
                aria-label={running ? t("composer.cancel_run") : sendPending ? t("composer.sending", { defaultValue: "Sending…" }) : t("composer.send")}
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
