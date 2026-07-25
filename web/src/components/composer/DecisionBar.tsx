import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentTaskMode, EmployeeAgent } from "../../types";
import { isEmployeeAgentRoutable } from "../../lib/agentDisplayNames";
import { ActionApprove, ActionHandoff, ActionRoute } from "../icons";
import { Button } from "../ui/button";
import { useDialogs } from "../ui/DialogProvider";

type DecisionAction = "approve" | "reject" | "rerun" | "mark_done" | "handoff";

export function DecisionBar({ logicalAgents, sendDecision, handoffOpen, setHandoffOpen, handoffAgentId, setHandoffAgentId, handoffMode, setHandoffMode, handoffNote, setHandoffNote, sendHandoff }: {
  logicalAgents: EmployeeAgent[];
  sendDecision: (kind: "approve" | "reject" | "rerun" | "mark_done") => Promise<void>;
  handoffOpen: boolean; setHandoffOpen: (v: boolean) => void;
  handoffAgentId: string; setHandoffAgentId: (id: string) => void;
  handoffMode: AgentTaskMode; setHandoffMode: (m: AgentTaskMode) => void;
  handoffNote: string; setHandoffNote: (v: string) => void;
  sendHandoff: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const approveRef = useRef<HTMLButtonElement>(null);
  const [pendingAction, setPendingAction] = useState<DecisionAction | null>(null);
  const pendingLabel = t("decision.pending", { defaultValue: "Working…" });

  // The bar mounts when a turn starts awaiting a decision; move keyboard and
  // screen-reader focus to its primary action so it is not missed.
  useEffect(() => {
    approveRef.current?.focus();
  }, []);

  const runAction = async (action: DecisionAction, run: () => Promise<void>) => {
    if (pendingAction) return;
    setPendingAction(action);
    try {
      await run();
    } finally {
      setPendingAction(null);
    }
  };

  // Reject discards the turn, so it confirms first — approve/rerun/mark_done
  // stay one-click since they are recoverable.
  const handleReject = async () => {
    if (pendingAction) return;
    const ok = await confirm({
      title: t("decision.reject_confirm_title"),
      message: t("decision.reject_confirm_message"),
      confirmLabel: t("decision.reject"),
      tone: "danger",
    });
    if (!ok) return;
    await runAction("reject", () => sendDecision("reject"));
  };

  const busy = pendingAction !== null;

  return (
    <>
      <div className="decision-bar">
        <Button variant="default" type="button" ref={approveRef} disabled={busy} loading={pendingAction === "approve"} loadingLabel={pendingLabel} onClick={() => void runAction("approve", () => sendDecision("approve"))}><ActionApprove size={14} /> {t("decision.approve")}</Button>
        <Button variant="ghost" type="button" disabled={busy} loading={pendingAction === "rerun"} loadingLabel={pendingLabel} onClick={() => void runAction("rerun", () => sendDecision("rerun"))}>{t("decision.rerun")}</Button>
        <Button variant="ghost" type="button" disabled={busy} loading={pendingAction === "mark_done"} loadingLabel={pendingLabel} onClick={() => void runAction("mark_done", () => sendDecision("mark_done"))}>{t("decision.mark_done")}</Button>
        <Button variant="destructive" type="button" disabled={busy} loading={pendingAction === "reject"} loadingLabel={pendingLabel} onClick={() => void handleReject()}>{t("decision.reject")}</Button>
        <Button variant="ghost" type="button" disabled={busy} aria-controls={handoffOpen ? "handoff-panel" : undefined} aria-expanded={handoffOpen} onClick={() => setHandoffOpen(!handoffOpen)}>
          <ActionHandoff size={14} /> {t("decision.handoff")}
        </Button>
      </div>
      {handoffOpen ? (
        <div id="handoff-panel" className="handoff-panel">
          <div className="handoff-panel-head">
            <span className="handoff-panel-mark" aria-hidden="true"><ActionRoute size={14} /></span>
            <span className="handoff-panel-title">{t("handoff.title")}</span>
          </div>
          <div className="handoff-row">
            <label htmlFor="handoff-agent">{t("handoff.route_to")}</label>
            <select id="handoff-agent" name="handoff-agent" value={handoffAgentId} onChange={(e) => setHandoffAgentId(e.target.value)}>
              {logicalAgents.map((agent) => {
                const isDisabled = !isEmployeeAgentRoutable(agent);
                return (
                  <option key={agent.id} value={agent.id} disabled={isDisabled}>
                    {isDisabled ? t("thread.agent_disabled_option", { agent: agent.displayName }) : agent.displayName}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="handoff-row">
            <label htmlFor="handoff-mode">{t("handoff.mode")}</label>
            <select id="handoff-mode" name="handoff-mode" value={handoffMode} onChange={(e) => setHandoffMode(e.target.value as AgentTaskMode)}>
              <option value="action">{t("mode.action")}</option>
              <option value="ask">{t("mode.ask")}</option>
              <option value="review">{t("mode.review")}</option>
            </select>
          </div>
          <div className="handoff-row handoff-row--note">
            <label htmlFor="handoff-note">{t("handoff.note_label")}</label>
            <input id="handoff-note" name="handoff-note" autoComplete="off" placeholder={t("handoff.note_placeholder")} value={handoffNote} onChange={(e) => setHandoffNote(e.target.value)} />
          </div>
          <div className="handoff-actions">
            <Button variant="ghost" type="button" disabled={busy} onClick={() => setHandoffOpen(false)}>{t("handoff.cancel")}</Button>
            <Button variant="default" type="button" disabled={busy} loading={pendingAction === "handoff"} loadingLabel={pendingLabel} onClick={() => void runAction("handoff", sendHandoff)}>{t("handoff.send")}</Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
