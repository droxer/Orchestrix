import { useTranslation } from "react-i18next";
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

  return (
    <section className="transcript-empty" aria-labelledby="transcript-empty-headline">
      <h2 id="transcript-empty-headline" className="transcript-empty-headline">
        {headline}
      </h2>
      <p className="transcript-empty-sublabel">{descriptor.role}</p>
    </section>
  );
}
