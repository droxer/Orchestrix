import { useTranslation } from "react-i18next";
import type { AgentTeam, EmployeeAgent } from "../../types";
import { IdentityMonogram } from "../IdentityMonogram";
import { ProfileImage } from "../ProfileImagePicker";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "@/components/ui/select";
import { isEmployeeAgentRoutable } from "../../lib/agentDisplayNames";
import { isTeamRoutable, teamAvailability } from "../../lib/taskAssignment";

const TEAM_VALUE_PREFIX = "team:";

export function teamSelectValue(teamId: string): string {
  return `${TEAM_VALUE_PREFIX}${teamId}`;
}

export function parseTeamSelectValue(value: string | null): string | null {
  return value?.startsWith(TEAM_VALUE_PREFIX) ? value.slice(TEAM_VALUE_PREFIX.length) : null;
}

// Target picker for the composer footer: selects who the thread talks to —
// one logical (employee) agent, or a whole agent team. Non-routable entries
// stay listed (disabled) with their availability spelled out so users can see
// why a target cannot take the thread. A team thread keeps the team fixed for
// its lifetime, so `teamLocked` renders the trigger read-only.
export function AgentSelect({ logicalAgents, activeLogicalAgentId, onLogicalAgentPicked, teams = [], activeTeamId = null, onTeamPicked, teamLocked = false, teamOptionsEnabled = false }: {
  logicalAgents: EmployeeAgent[];
  activeLogicalAgentId: string | null;
  onLogicalAgentPicked: (agent: EmployeeAgent) => void;
  /** Full live-team list: resolves the active team chip even when picking is
   *  disabled, so a started team thread still names its team. */
  teams?: AgentTeam[];
  activeTeamId?: string | null;
  onTeamPicked?: (team: AgentTeam) => void;
  teamLocked?: boolean;
  /** Teams are pickable only while staging a new thread — a started thread
   *  keeps the participants it began with. */
  teamOptionsEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const activeLogicalAgent = logicalAgents.find(
    (agent) => agent.id === activeLogicalAgentId && isEmployeeAgentRoutable(agent),
  );
  const activeTeam = teams.find((team) => team.id === activeTeamId && !team.deletedAt) ?? null;
  const handleSelected = (value: string | null) => {
    const teamId = parseTeamSelectValue(value);
    if (teamId) {
      const team = teams.find((candidate) => candidate.id === teamId);
      if (team && isTeamRoutable(team)) onTeamPicked?.(team);
      return;
    }
    const next = logicalAgents.find((agent) => agent.id === value);
    if (next && isEmployeeAgentRoutable(next)) onLogicalAgentPicked(next);
  };
  return (
    <Select value={activeTeam ? teamSelectValue(activeTeam.id) : (activeLogicalAgent?.id ?? null)} onValueChange={handleSelected}>
      <SelectTrigger
        size="sm"
        className="chat-agent-select"
        disabled={teamLocked || (logicalAgents.length === 0 && (!teamOptionsEnabled || teams.length === 0))}
        data-availability={activeTeam ? teamAvailability(activeTeam) : activeLogicalAgent ? activeLogicalAgent.availability : "unavailable"}
        aria-label={teamOptionsEnabled && teams.length > 0 ? t("thread.talk_to_agent_or_team") : t("thread.talk_to_agent")}
      >
        {activeTeam ? (
          <>
            <ProfileImage
              src={activeTeam.profileImageUrl}
              alt=""
              fallback={<IdentityMonogram name={activeTeam.name} size={8} />}
              className="chat-active-agent-mark"
            />
            <span className="chat-agent-select-name" translate="no">
              {activeTeam.name}
            </span>
          </>
        ) : activeLogicalAgent ? (
          <>
            <ProfileImage
              src={activeLogicalAgent.profileImageUrl}
              alt=""
              fallback={<IdentityMonogram name={activeLogicalAgent.displayName} size={8} />}
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
        {!activeTeam && activeLogicalAgent?.availability === "busy" ? (
          <>
            <span className="header-agent-busy-pip" aria-hidden="true" />
            <span className="sr-only">{t("status.busy")}</span>
          </>
        ) : null}
      </SelectTrigger>
      <SelectContent className="chat-agent-select-content" align="start" alignItemWithTrigger={false} side="top">
        {teamOptionsEnabled && teams.length > 0 ? (
          <SelectGroup>
            <SelectLabel>{t("composer.teams_group")}</SelectLabel>
            {teams.map((team) => {
              const isRoutable = isTeamRoutable(team);
              const availability = teamAvailability(team);
              const availabilityLabel = !isRoutable
                ? t(`status.${availability}`, { defaultValue: availability })
                : null;
              return (
                <SelectItem
                  key={team.id}
                  value={teamSelectValue(team.id)}
                  className="chat-agent-option"
                  disabled={!isRoutable}
                  data-availability={availability}
                >
                  <ProfileImage
                    src={team.profileImageUrl}
                    alt=""
                    fallback={<IdentityMonogram name={team.name} size={8} />}
                    className="chat-agent-option-mark"
                  />
                  <span translate="no">{team.name}</span>
                  <span className="chat-agent-option-availability">
                    {t("teams.member_count", { count: team.members.length })}
                  </span>
                  {availabilityLabel ? (
                    <span className="chat-agent-option-availability" data-availability={availability}>
                      <span className="chat-agent-state-pip" data-availability={availability} aria-hidden="true" />
                      {availabilityLabel}
                    </span>
                  ) : null}
                </SelectItem>
              );
            })}
          </SelectGroup>
        ) : null}
        {teamOptionsEnabled && teams.length > 0 ? (
          <SelectGroup>
            <SelectLabel>{t("composer.agents_group")}</SelectLabel>
            {agentOptions({ logicalAgents, t })}
          </SelectGroup>
        ) : (
          agentOptions({ logicalAgents, t })
        )}
      </SelectContent>
    </Select>
  );
}

function agentOptions({ logicalAgents, t }: {
  logicalAgents: EmployeeAgent[];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return logicalAgents.map((logicalAgent) => {
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
        <ProfileImage
          src={logicalAgent.profileImageUrl}
          alt=""
          fallback={<IdentityMonogram name={logicalAgent.displayName} size={8} />}
          className="chat-agent-option-mark"
        />
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
  });
}
