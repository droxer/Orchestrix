import { useTranslation } from "react-i18next";
import { AgentMark } from "./AgentMark";
import { RelayEmptyState } from "./RelayEmptyState";
import type { AgentName } from "../types";

type AgentDescriptor = { blurb: string };

type TranscriptEmptyProps = {
  selectedEmployee: string;
  activeAgent: AgentName;
  activeAgentDisplayName: string;
  agentDescriptors: Record<AgentName, AgentDescriptor>;
};

export function TranscriptEmpty({
  selectedEmployee,
  activeAgent,
  activeAgentDisplayName,
  agentDescriptors,
}: TranscriptEmptyProps) {
  const { t } = useTranslation();
  const descriptor = agentDescriptors[activeAgent];
  const headline = selectedEmployee
    ? t("transcript.ready_for")
    : t("transcript.ready_no_employee", { agent: activeAgentDisplayName });

  return (
    <RelayEmptyState
      className="transcript-empty"
      titleId="transcript-empty-headline"
      title={headline}
      body={descriptor.blurb}
      hint={selectedEmployee ? t("transcript.hint_agent_picker") : undefined}
      illustration={(
        <span className="relay-empty-avatar agent-avatar" data-agent={activeAgent} aria-hidden="true">
          <AgentMark agent={activeAgent} size={28} />
        </span>
      )}
    />
  );
}
