import { useTranslation } from "react-i18next";
import type { AgentName, AgentTaskMode } from "../../types";
import { ActionApprove, ActionHandoff } from "../icons";

export function DecisionBar({ agentNames, disabledAgents, sendDecision, handoffOpen, setHandoffOpen, handoffAgent, setHandoffAgent, handoffMode, setHandoffMode, handoffNote, setHandoffNote, sendHandoff }: {
  agentNames: AgentName[];
  disabledAgents?: AgentName[];
  sendDecision: (kind: "approve" | "reject" | "rerun" | "mark_done") => Promise<void>;
  handoffOpen: boolean; setHandoffOpen: (v: boolean) => void;
  handoffAgent: AgentName; setHandoffAgent: (a: AgentName) => void;
  handoffMode: AgentTaskMode; setHandoffMode: (m: AgentTaskMode) => void;
  handoffNote: string; setHandoffNote: (v: string) => void;
  sendHandoff: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const disabledSet = new Set(disabledAgents ?? []);
  return (
    <>
      <div className="decision-bar">
        <button type="button" onClick={() => void sendDecision("approve")}><ActionApprove size={14} /> {t("decision.approve")}</button>
        <button type="button" onClick={() => void sendDecision("rerun")}>{t("decision.rerun")}</button>
        <button type="button" onClick={() => void sendDecision("mark_done")}>{t("decision.mark_done")}</button>
        <button type="button" className="danger-soft" onClick={() => void sendDecision("reject")}>{t("decision.reject")}</button>
        <button type="button" className="primary" aria-controls="handoff-panel" aria-expanded={handoffOpen} onClick={() => setHandoffOpen(!handoffOpen)}>
          <ActionHandoff size={14} /> {t("decision.handoff")}
        </button>
      </div>
      {handoffOpen ? (
        <div id="handoff-panel" className="handoff-panel">
          <div className="handoff-row">
            <label htmlFor="handoff-agent">{t("handoff.route_to")}</label>
            <select id="handoff-agent" name="handoff-agent" value={handoffAgent} onChange={(e) => setHandoffAgent(e.target.value as AgentName)}>
              {agentNames.map((a) => {
                const isDisabled = disabledSet.has(a);
                return (
                  <option key={a} value={a} disabled={isDisabled}>
                    {isDisabled ? t("thread.agent_disabled_option", { agent: a }) : a}
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
            <button type="button" onClick={() => setHandoffOpen(false)}>{t("handoff.cancel")}</button>
            <button type="button" className="primary" onClick={() => void sendHandoff()}>{t("handoff.send")}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
