import { useTranslation } from "react-i18next";
import type { MentionableAgent } from "../../lib/agentDisplayNames";
import { agentLabel } from "../../lib/plan";
import { AgentMark } from "../AgentMark";
import { mentionOptionId } from "../../lib/mentions";

export function MentionPopover({ filteredAgents, mentionIndex, insertMention }: {
  filteredAgents: MentionableAgent[];
  mentionIndex: number;
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
          <span className="mention-role" translate="no">{agentLabel(agent.executorKind)}</span>
        </div>
      ))}
    </div>
  );
}
