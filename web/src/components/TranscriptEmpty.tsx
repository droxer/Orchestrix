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
      <span className="transcript-empty-watermark" aria-hidden="true">
        {activeAgent.charAt(0).toUpperCase()}
      </span>

      <header className="transcript-empty-eyebrow">
        <span>{t("transcript.new_session")}</span>
      </header>

      <div className="transcript-empty-grid">
        <h2 id="transcript-empty-headline" className="transcript-empty-headline">
          {headline}
        </h2>

        <aside className="transcript-empty-card">
          <p className="transcript-empty-role" translate="no">@{activeAgent}</p>
          <p className="transcript-empty-role-meta">{descriptor.role}</p>
          <p className="transcript-empty-blurb">{descriptor.blurb}</p>
        </aside>
      </div>

      <dl className="transcript-empty-system" aria-hidden="true">
        <div className="transcript-empty-system-row">
          <dt>employee</dt>
          <dd className="transcript-empty-system-sep">·····</dd>
          <dd data-state={selectedEmployee ? "ready" : "pending"}>
            {selectedEmployee ? `@${selectedEmployee}` : "—"}
          </dd>
        </div>
        <div className="transcript-empty-system-row">
          <dt>agent</dt>
          <dd className="transcript-empty-system-sep">·····</dd>
          <dd data-state="ready">{activeAgent}</dd>
        </div>
        <div className="transcript-empty-system-row">
          <dt>session</dt>
          <dd className="transcript-empty-system-sep">·····</dd>
          <dd data-state="pending">{t("transcript.awaiting_first")}</dd>
        </div>
      </dl>
    </section>
  );
}
