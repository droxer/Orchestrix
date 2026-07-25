import { useTranslation } from "react-i18next";
import type { AgentName, EmployeeAgent } from "../../types";
import { AgentMark } from "../AgentMark";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { isEmployeeAgentRoutable } from "../../lib/agentDisplayNames";

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
  const activeLogicalAgent = logicalAgents.find(
    (agent) => agent.id === activeLogicalAgentId && isEmployeeAgentRoutable(agent),
  );
  const handleAgentSelected = (value: string | null) => {
    const next = logicalAgents.find((agent) => agent.id === value);
    if (next && isEmployeeAgentRoutable(next)) onLogicalAgentPicked(next);
  };
  return (
    <Select value={activeLogicalAgent?.id ?? null} onValueChange={handleAgentSelected}>
      <SelectTrigger
        size="sm"
        className="chat-agent-select"
        disabled={logicalAgents.length === 0}
        data-availability={activeLogicalAgent ? activeLogicalAgent.availability : "unavailable"}
        aria-label={t("thread.talk_to_agent")}
      >
        {activeLogicalAgent ? (
          <>
            <AgentMark
              agent={activeLogicalAgent.executorKind ?? activeAgent}
              size={16}
              className="chat-active-agent-mark"
            />
            <span className="chat-agent-select-name" translate="no">
              {activeLogicalAgent.displayName}
            </span>
          </>
        ) : (
          <span className="chat-agent-select-unavailable">
            <span className="chat-agent-state-pip" data-availability="offline" aria-hidden="true" />
            {t("thread.no_available_agent")}
          </span>
        )}
        {activeLogicalAgent?.availability === "busy" ? (
          <>
            <span className="header-agent-busy-pip" aria-hidden="true" />
            <span className="sr-only">{t("status.busy")}</span>
          </>
        ) : null}
      </SelectTrigger>
      <SelectContent className="chat-agent-select-content" align="start" alignItemWithTrigger={false} side="top">
        {logicalAgents.map((logicalAgent) => {
          const isInactive = !logicalAgent.enabled || Boolean(logicalAgent.deletedAt);
          const isRoutable = isEmployeeAgentRoutable(logicalAgent);
          const isBusy = logicalAgent.availability === "busy";
          const visualAvailability = isInactive ? "inactive" : logicalAgent.availability;
          const availabilityLabel = !isRoutable
            ? t(`status.${visualAvailability}`, {
                defaultValue: visualAvailability,
              })
            : null;
          return (
            <SelectItem
              key={logicalAgent.id}
              value={logicalAgent.id}
              className="chat-agent-option"
              disabled={!isRoutable}
              data-availability={visualAvailability}
            >
              <AgentMark agent={logicalAgent.executorKind} size={16} className="chat-agent-option-mark" />
              <span translate="no">{logicalAgent.displayName}</span>
              {availabilityLabel ? (
                <span className="chat-agent-option-availability" data-availability={visualAvailability}>
                  <span className="chat-agent-state-pip" data-availability={visualAvailability} aria-hidden="true" />
                  {availabilityLabel}
                </span>
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
