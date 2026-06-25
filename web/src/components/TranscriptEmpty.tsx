import { useTranslation } from "react-i18next";
import { AgentMark } from "./AgentMark";
import { RelayEmptyState } from "./RelayEmptyState";
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
  const descriptor = agentDescriptors[activeAgent];
  const headline = selectedEmployee
    ? t("transcript.ready_for", { employee: selectedEmployee, agent: activeAgent })
    : t("transcript.ready_no_employee", { agent: activeAgent });

  const body = descriptor.blurb || descriptor.role;

  return (
    <RelayEmptyState
      className="transcript-empty"
      titleId="transcript-empty-headline"
      title={headline}
      body={body}
      hint={selectedEmployee ? t("transcript.hint_mention") : undefined}
      atmosphere
      illustration={(
        <span className="relay-empty-avatar agent-avatar" data-agent={activeAgent}>
          <AgentMark agent={activeAgent} size={28} />
        </span>
      )}
    />
  );
}
