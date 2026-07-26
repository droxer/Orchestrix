import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AgentName, AgentTaskMode, DaemonNodeMonitorRecord, EmployeeAgent } from "../../types";
import { sendShortcutLabel } from "../../lib/sendShortcut";
import { ActionSend, ActionStop } from "../icons";
import { ModeToggle } from "./ModeToggle";
import { AgentSelect } from "./AgentSelect";
import { useComposer } from "../../hooks/useComposer";
import { ThreadRuntimeReadout, ThreadRuntimeSelect } from "./ThreadRuntimeSelect";


export type ComposerHandle = {
  clear: () => void;
  focus: () => void;
  getText: () => string;
  /** Put text back in the box — used to return a message a failed send ate. */
  setText: (text: string) => void;
};

// Message composer: textarea, agent and mode controls, and the send/cancel
// control. Draft state stays inside this component so every
// keystroke does not re-render the full application shell and transcript.
const ComposerView = forwardRef<ComposerHandle, {
  composerMode: AgentTaskMode;
  setComposerMode: Dispatch<SetStateAction<AgentTaskMode>>;
  activeAgent: AgentName;
  logicalAgents: EmployeeAgent[];
  activeLogicalAgentId: string | null;
  onLogicalAgentPicked: (agent: EmployeeAgent) => void;
  activeAgentDisplayName: string;
  selectedEmployee: string;
  initializingThread: boolean;
  runtimeNodes: DaemonNodeMonitorRecord[];
  runtimeNodeId: string | null;
  /** The picked computer resolved against the whole fleet, not just the
   *  currently-selectable subset. */
  selectedRuntimeNode: DaemonNodeMonitorRecord | null;
  /** The computer an already-started thread is pinned to, shown read-only. */
  activeRuntimeNode: DaemonNodeMonitorRecord | null;
  onRuntimeNodeChange: (nodeId: string) => void;
  running: boolean;
  onSend: () => void;
  onCancelRun: () => void;
}>(function Composer({ composerMode, setComposerMode, activeAgent, logicalAgents, activeLogicalAgentId, onLogicalAgentPicked, activeAgentDisplayName, selectedEmployee, initializingThread, runtimeNodes, runtimeNodeId, selectedRuntimeNode, activeRuntimeNode, onRuntimeNodeChange, running, onSend, onCancelRun }, ref) {
  const { t } = useTranslation();
  const composer = useComposer();
  const {
    composerText, setComposerText, textareaRef,
  } = composer;
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
    clear: () => setComposerText(""),
    focus: () => textareaRef.current?.focus(),
    getText: () => composerText,
    setText: (text: string) => setComposerText(text),
  }), [composerText, setComposerText, textareaRef]);

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); triggerSend(); }}>
      {/* A new thread picks its computer; a started one is pinned to the
          computer it dispatched on, so the rail stays put and turns into a
          readout instead of disappearing. */}
      {initializingThread ? (
        <ThreadRuntimeSelect
          nodes={runtimeNodes}
          value={runtimeNodeId}
          selectedNode={selectedRuntimeNode}
          onValueChange={onRuntimeNodeChange}
        />
      ) : activeRuntimeNode ? (
        <ThreadRuntimeReadout node={activeRuntimeNode} />
      ) : null}
      <div className="composer-input-wrap" data-running={running || undefined}>
        <div className="composer-input">
          <textarea
            ref={textareaRef}
            aria-label={selectedEmployee
              ? t("composer.aria_label", { employee: selectedEmployee, agent: activeAgentDisplayName })
              : t("composer.aria_label_no_employee", { agent: activeAgentDisplayName })}
            autoComplete="off"
            name="message"
            placeholder={selectedEmployee
              ? t("composer.placeholder")
              : t("composer.placeholder_no_employee")}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onKeyDown={(e) => {
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
                disabled={!running && (
                  sendPending
                  || !composerText.trim()
                  || (initializingThread && !runtimeNodeId)
                )}
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
