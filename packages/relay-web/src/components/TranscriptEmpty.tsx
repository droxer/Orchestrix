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
  return (
    <div className="transcript-empty">
      <RelayMark className="empty-brand-mark" width={64} height={43} />
      <p className="eyebrow">New workspace session</p>
      <h2>
        @{selectedEmployee} is ready for {activeAgent}.
      </h2>
      <p>{agentDescriptors[activeAgent].blurb}</p>
    </div>
  );
}
