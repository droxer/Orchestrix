import { useTranslation } from "react-i18next";
import type { AgentTaskMode, EmployeeAgent } from "../../types";
import { isLogicalAgentRoutable } from "../../lib/agentDisplayNames";
import { ActionApprove, ActionHandoff } from "../icons";
import { Button } from "../ui/button";

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
  return (
    <>
      <div className="decision-bar">
        <Button variant="ghost" type="button" onClick={() => void sendDecision("approve")}><ActionApprove size={14} /> {t("decision.approve")}</Button>
        <Button variant="ghost" type="button" onClick={() => void sendDecision("rerun")}>{t("decision.rerun")}</Button>
        <Button variant="ghost" type="button" onClick={() => void sendDecision("mark_done")}>{t("decision.mark_done")}</Button>
        <Button variant="ghost" type="button" className="danger-soft" onClick={() => void sendDecision("reject")}>{t("decision.reject")}</Button>
        <Button variant="ghost" type="button" className="primary" aria-controls="handoff-panel" aria-expanded={handoffOpen} onClick={() => setHandoffOpen(!handoffOpen)}>
          <ActionHandoff size={14} /> {t("decision.handoff")}
        </Button>
      </div>
      {handoffOpen ? (
        <div id="handoff-panel" className="handoff-panel">
          <div className="handoff-row">
            <label htmlFor="handoff-agent">{t("handoff.route_to")}</label>
            <select id="handoff-agent" name="handoff-agent" value={handoffAgentId} onChange={(e) => setHandoffAgentId(e.target.value)}>
              {logicalAgents.map((agent) => {
                const isDisabled = !isLogicalAgentRoutable(agent.availability);
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
          <input aria-label={t("handoff.note_placeholder")} name="handoff-note" autoComplete="off" placeholder={t("handoff.note_placeholder")} value={handoffNote} onChange={(e) => setHandoffNote(e.target.value)} />
          <div className="handoff-actions">
            <Button variant="ghost" type="button" onClick={() => setHandoffOpen(false)}>{t("handoff.cancel")}</Button>
            <Button variant="ghost" type="button" className="primary" onClick={() => void sendHandoff()}>{t("handoff.send")}</Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
