import { emitOrPrint, status } from "./format.js";
import {
  MAX_CLAUDE_FAILURES,
  MAX_CODEX_FAILURES,
  MAX_PI_FAILURES,
  type AgentOutputSink,
  type AgentState,
} from "./state.js";

export type Route = "claude_implement" | "pi_implement" | "codex_review" | "__end__";

export function routeClaudeHandoff(state: AgentState, sink?: AgentOutputSink): Route {
  if (state.last_exit_code === 0) {
    emitOrPrint(sink, status("ok", "Claude finished; handing off to Pi."));
    return "pi_implement";
  }
  if (state.claude_failures < MAX_CLAUDE_FAILURES) {
    emitOrPrint(sink, status("warn", `Claude failed with exit ${state.last_exit_code}; retry ${state.claude_failures}/${MAX_CLAUDE_FAILURES}.`));
    return "claude_implement";
  }
  emitOrPrint(sink, status("error", `Claude failed ${MAX_CLAUDE_FAILURES} times; halting.`));
  return "__end__";
}

export function routePiHandoff(state: AgentState, sink?: AgentOutputSink): Route {
  if (state.last_exit_code === 0) {
    emitOrPrint(sink, status("ok", "Pi finished; handing off to Codex review."));
    return "codex_review";
  }
  if (state.pi_failures < MAX_PI_FAILURES) {
    emitOrPrint(sink, status("warn", `Pi failed with exit ${state.last_exit_code}; retry ${state.pi_failures}/${MAX_PI_FAILURES}.`));
    return "pi_implement";
  }
  emitOrPrint(sink, status("error", `Pi failed ${MAX_PI_FAILURES} times; halting.`));
  return "__end__";
}

export function routeCodexHandoff(state: AgentState, sink?: AgentOutputSink): Route {
  const verdict = state.codex_verdict || "failed";
  if (verdict === "approved") {
    emitOrPrint(sink, status("ok", "Codex approved; workflow complete."));
    return "__end__";
  }
  if (verdict === "rejected") {
    emitOrPrint(sink, status("warn", "Codex rejected the change; handing feedback back to Claude."));
    return "claude_implement";
  }
  if (state.codex_failures < MAX_CODEX_FAILURES) {
    const reason = state.last_exit_code === 0
      ? "Codex review did not produce a valid verdict"
      : `Codex review failed with exit ${state.last_exit_code}`;
    emitOrPrint(sink, status("warn", `${reason}; retry ${state.codex_failures}/${MAX_CODEX_FAILURES}.`));
    return "codex_review";
  }
  emitOrPrint(sink, status("error", `Codex review failed ${MAX_CODEX_FAILURES} times; halting.`));
  return "__end__";
}
