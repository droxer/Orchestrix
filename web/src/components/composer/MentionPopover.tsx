import { useTranslation } from "react-i18next";
import type { AgentName } from "../../types";
import { AgentMark } from "../AgentMark";

export function MentionPopover({ filteredAgents, mentionIndex, insertMention }: {
  filteredAgents: AgentName[]; mentionIndex: number; insertMention: (a: AgentName) => void;
}) {
  const { t } = useTranslation();
  return (
    <div id="mention-popover" className="mention-popover agent-picker" role="listbox" aria-label={t("composer.address_agent")}>
      {filteredAgents.map((a, i) => (
        <button key={a} id={`mention-option-${i}`} type="button" role="option" aria-selected={i === mentionIndex} className={i === mentionIndex ? "active" : ""} onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}>
          <span className="agent-avatar" data-agent={a} aria-hidden="true"><AgentMark agent={a} size={16} /></span>
          <span translate="no">@{a}</span>
          <span className="mention-role">{t(`agent.${a}.role`)}</span>
        </button>
      ))}
    </div>
  );
}
