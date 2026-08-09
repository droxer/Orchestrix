import type { Tone } from "../types";
import type { StatusValue } from "./threadStatus";

// Canonical status → tone mapping: live work (running/busy/provisioning) is
// info, queued/paused (pending/stopped) is warn, ready/done is good, and
// every failure or unreachable state is bad. Truly unknown values fall
// through to neutral so a new backend state never silently masquerades as a
// warning. Per-domain mappers (adminHelpers, agentPlacements, nodeAgents)
// follow these same semantics for their own status vocabularies.
export function statusTone(value: StatusValue): Tone {
  switch (value) {
    case "ready":
    case "completed":
    case "done":
      return "good";
    case "running":
    case "busy":
    case "provisioning":
      return "info";
    case "pending":
    case "stopped":
      return "warn";
    case "failed":
    case "blocked":
    case "cancelled":
    case "offline":
    case "stale":
      return "bad";
    default:
      return "neutral";
  }
}
