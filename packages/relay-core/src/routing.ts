import { emitOrPrint, status, type AgentOutputSink } from "./format.js";
import { getAgent } from "./agents.js";
import { failureCount, type AgentState } from "./state.js";

export type Route = "claude_implement" | "pi_implement" | "__end__";

const MAX_CLAUDE_FAILURES = getAgent("claude").maxFailures;
const MAX_PI_FAILURES = getAgent("pi").maxFailures;

export function routeClaudeHandoff(state: AgentState, sink?: AgentOutputSink): Route {
  if (state.last_exit_code === 0) {
    return "pi_implement";
  }
  const failures = failureCount(state, "claude");
  if (failures < MAX_CLAUDE_FAILURES) {
    emitOrPrint(sink, status("warn", `Claude failed with exit ${state.last_exit_code}; retry ${failures}/${MAX_CLAUDE_FAILURES}.`));
    return "claude_implement";
  }
  emitOrPrint(sink, status("error", `Claude failed ${MAX_CLAUDE_FAILURES} times; halting.`));
  return "__end__";
}

export function routePiHandoff(state: AgentState, sink?: AgentOutputSink): Route {
  if (state.last_exit_code === 0) {
    return "__end__";
  }
  const failures = failureCount(state, "pi");
  if (failures < MAX_PI_FAILURES) {
    emitOrPrint(sink, status("warn", `Pi failed with exit ${state.last_exit_code}; retry ${failures}/${MAX_PI_FAILURES}.`));
    return "pi_implement";
  }
  emitOrPrint(sink, status("error", `Pi failed ${MAX_PI_FAILURES} times; halting.`));
  return "__end__";
}
