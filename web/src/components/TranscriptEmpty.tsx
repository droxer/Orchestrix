import { useTranslation } from "react-i18next";
import { AgentMark } from "./AgentMark";
import { RelayEmptyState } from "./RelayEmptyState";
import type { AgentName } from "../types";

type AgentDescriptor = { role: string; blurb: string };

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

  const body = descriptor.blurb || descriptor.role;

  return (
    <RelayEmptyState
      className="transcript-empty"
      titleId="transcript-empty-headline"
      title={headline}
      body={body}
      hint={selectedEmployee ? t("transcript.hint_mention") : undefined}
      mark
      illustration={(
        <span className="atelier-orbit" aria-hidden="true">
          <i className="atelier-orbit-dot atelier-orbit-dot--one" />
          <i className="atelier-orbit-dot atelier-orbit-dot--two" />
          <span className="relay-empty-avatar agent-avatar" data-agent={activeAgent}>
            <AgentMark agent={activeAgent} size={28} />
          </span>
        </span>
      )}
    />
  );
}
