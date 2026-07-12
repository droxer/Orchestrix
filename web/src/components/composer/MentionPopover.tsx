import { useTranslation } from "react-i18next";
import type { AgentName } from "../../types";
import type { MentionableAgent } from "../../lib/agentDisplayNames";
import { AgentMark } from "../AgentMark";
import { mentionOptionId } from "../../lib/mentions";

export function MentionPopover({ filteredAgents, mentionIndex, roleLabels, insertMention }: {
  filteredAgents: MentionableAgent[];
  mentionIndex: number;
  roleLabels?: Partial<Record<AgentName, string>>;
  insertMention: (agent: MentionableAgent) => void;
}) {
  const { t } = useTranslation();
  return (
    <div id="mention-popover" className="mention-popover agent-picker" role="listbox" aria-label={t("composer.address_agent")}>
      {filteredAgents.map((agent, i) => (
        <div
          key={agent.id}
          id={mentionOptionId(i)}
          role="option"
          aria-selected={i === mentionIndex}
          className={i === mentionIndex ? "active" : ""}
          onMouseDown={(e) => { e.preventDefault(); insertMention(agent); }}
        >
          <span className="agent-avatar" data-agent={agent.executorKind} aria-hidden="true"><AgentMark agent={agent.executorKind} size={16} /></span>
          <span translate="no">@{agent.displayName}</span>
          <span className="mention-role">{roleLabels?.[agent.executorKind] ?? t(`agent.${agent.executorKind}.role`)}</span>
        </div>
      ))}
    </div>
  );
}
