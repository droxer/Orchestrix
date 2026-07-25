import { useTranslation } from "react-i18next";
import type { AgentName, EmployeeAgent } from "../../types";
import { AgentMark } from "../AgentMark";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { isLogicalAgentRoutable } from "../../lib/agentDisplayNames";

// Agent picker for the composer footer: selects which logical (employee) agent
// the thread talks to. Non-routable agents stay listed (disabled) with
// their availability spelled out so users can see why an agent cannot take
// the thread.
export function AgentSelect({ activeAgent, logicalAgents, activeLogicalAgentId, onLogicalAgentPicked }: {
  activeAgent: AgentName;
  logicalAgents: EmployeeAgent[];
  activeLogicalAgentId: string | null;
  onLogicalAgentPicked: (agent: EmployeeAgent) => void;
}) {
  const { t } = useTranslation();
  const activeLogicalAgent = logicalAgents.find((agent) => agent.id === activeLogicalAgentId);
  const handleAgentSelected = (value: string | null) => {
    const next = logicalAgents.find((agent) => agent.id === value);
    if (next && isLogicalAgentRoutable(next.availability)) onLogicalAgentPicked(next);
  };
  if (logicalAgents.length === 0) return null;
  return (
    <Select value={activeLogicalAgentId} onValueChange={handleAgentSelected}>
      <SelectTrigger size="sm" className="chat-agent-select" aria-label={t("thread.talk_to_agent")}>
        <AgentMark
          agent={activeLogicalAgent?.executorKind ?? activeAgent}
          size={16}
          className="chat-active-agent-mark"
        />
        <span className="chat-agent-select-name" translate="no">
          {activeLogicalAgent?.displayName ?? activeAgent}
        </span>
        {activeLogicalAgent?.availability === "busy" ? (
          <>
            <span className="header-agent-busy-pip" aria-hidden="true" />
            <span className="sr-only">{t("status.busy")}</span>
          </>
        ) : null}
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false} side="top">
        {logicalAgents.map((logicalAgent) => {
          const isRoutable = isLogicalAgentRoutable(logicalAgent.availability);
          const isBusy = logicalAgent.availability === "busy";
          const availabilityLabel = !isRoutable
            ? t(`admin.v2.placement_status.${logicalAgent.availability}`, {
                defaultValue: logicalAgent.availability,
              })
            : null;
          return (
            <SelectItem
              key={logicalAgent.id}
              value={logicalAgent.id}
              disabled={!isRoutable}
              data-availability={logicalAgent.availability}
            >
              <AgentMark agent={logicalAgent.executorKind} size={16} className="chat-agent-option-mark" />
              <span translate="no">{logicalAgent.displayName}</span>
              {availabilityLabel ? (
                <span className="chat-agent-option-availability">{availabilityLabel}</span>
              ) : null}
              {isBusy ? (
                <>
                  <span className="header-agent-busy-pip" aria-hidden="true" />
                  <span className="sr-only">{t("status.busy")}</span>
                </>
              ) : null}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
