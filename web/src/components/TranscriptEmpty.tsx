import { useTranslation } from "react-i18next";
import { RelayMark } from "./RelayMark";
import type { AgentName } from "../types";

type AgentDescriptor = { role: string; blurb: string };

type TranscriptEmptyProps = {
  selectedEmployee: string;
  activeAgent: AgentName;
  agentDescriptors: Record<AgentName, AgentDescriptor>;
};

export function TranscriptEmpty({
  selectedEmployee,
  activeAgent,
  agentDescriptors,
}: TranscriptEmptyProps) {
  const { t } = useTranslation();
  return (
    <div className="transcript-empty">
      <RelayMark className="empty-brand-mark" width={64} height={43} />
      <p className="eyebrow">{t("transcript.new_session")}</p>
      <h2>
        {selectedEmployee
          ? t("transcript.ready_for", { employee: selectedEmployee, agent: activeAgent })
          : t("transcript.ready_no_employee", { agent: activeAgent })}
      </h2>
      <p>{agentDescriptors[activeAgent].blurb}</p>
    </div>
  );
}
