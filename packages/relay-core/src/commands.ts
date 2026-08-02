import { anthropicModel, openaiModel, piModel, piProvider } from "./env.js";
import { agentWorkspacePath, codexCliConfigOverrides, runAsAgent } from "./guest.js";
import {
  askPrompt,
  claudeTaskPrompt,
  codexActionPrompt,
  kimiTaskPrompt,
  piTaskPrompt,
  reviewPrompt,
} from "./prompts.js";
import { kimiModel } from "./env.js";
import { escapeRegExp, shellCommand, shellQuote } from "./shell.js";
import type { AgentState } from "./state.js";

export function buildCodexReviewCommand(state: AgentState, workspacePath?: string): string {
  const argv = [...codexBaseArgv({ workspacePath }), reviewPrompt(state)];
  return runAsAgent(shellCommand(argv), "codex", workspacePath);
}

export function buildCodexActionCommand(state: AgentState, workspacePath?: string): string {
  const argv = [...codexBaseArgv({ workspacePath }), codexActionPrompt(state)];
  return runAsAgent(shellCommand(argv), "codex", workspacePath);
}

export function buildCodexAskCommand(state: AgentState, workspacePath?: string): string {
  const argv = [...codexBaseArgv({ readOnly: true, workspacePath }), askPrompt(state)];
  return runAsAgent(shellCommand(argv), "codex", workspacePath);
}

function codexBaseArgv({ readOnly = false, workspacePath }: { readOnly?: boolean; workspacePath?: string } = {}): string[] {
  const workspace = workspacePath ?? agentWorkspacePath();
  const argv = [
    "stdbuf",
    "-oL",
    "-eL",
    "codex",
    ...codexCliConfigOverrides(),
    "-C",
    workspace,
    "exec",
    "--json",
    "--skip-git-repo-check",
    // Ask mode confines Codex to a read-only sandbox with no approvals; action
    // mode keeps full write access.
    ...(readOnly
      ? ["--sandbox", "read-only"]
      : ["--dangerously-bypass-approvals-and-sandbox"]),
  ];
  const model = openaiModel();
  if (model) argv.push("-m", model);
  return argv;
}

export function buildClaudeActionCommand(state: AgentState, workspacePath?: string): string {
  return buildClaudeCommand(claudeTaskPrompt(state), { workspacePath });
}

export function buildClaudeReviewCommand(state: AgentState, workspacePath?: string): string {
  return buildClaudeCommand(reviewPrompt(state), { workspacePath });
}

export function buildClaudeAskCommand(state: AgentState, workspacePath?: string): string {
  // Plan mode runs Claude read-only: it can inspect the workspace but cannot
  // edit files, so it answers the question without making changes.
  return buildClaudeCommand(askPrompt(state), { permissionMode: "plan", workspacePath });
}

function buildClaudeCommand(
  prompt: string,
  { permissionMode = "bypassPermissions", workspacePath }: { permissionMode?: string; workspacePath?: string } = {},
): string {
  const workspace = workspacePath ?? agentWorkspacePath();
  const argv = [
    "stdbuf",
    "-oL",
    "-eL",
    "claude",
    "-p",
    "--permission-mode",
    permissionMode,
    "--add-dir",
    workspace,
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
  ];
  const model = anthropicModel();
  if (model) argv.push("--model", model);
  argv.push(prompt);
  return runAsAgent(shellCommand(argv), "claude", workspacePath);
}

export function buildPiActionCommand(state: AgentState, workspacePath?: string): string {
  return buildPiCommand(piTaskPrompt(state), workspacePath);
}

export function buildPiReviewCommand(state: AgentState, workspacePath?: string): string {
  return buildPiCommand(reviewPrompt(state), workspacePath);
}

// Pi has no confirmed native read-only flag yet, so ask mode relies on the
// read-only ask prompt. Tighten with a CLI flag once one is confirmed.
export function buildPiAskCommand(state: AgentState, workspacePath?: string): string {
  return buildPiCommand(askPrompt(state), workspacePath);
}

function buildPiCommand(prompt: string, workspacePath?: string): string {
  const argv = ["stdbuf", "-oL", "-eL", "pi", "--no-session"];
  const provider = piProvider();
  if (provider) argv.push("--provider", provider);
  const model = piModel();
  if (model) argv.push("--model", model);
  const jsonCommand = shellCommand([...argv, "--mode", "json", prompt]);
  const streamingCommand = shellCommand([...argv, "-P", prompt]);
  const printCommand = shellCommand([...argv, "-p", prompt]);
  const supportsJsonMode =
    "pi --help 2>&1 | grep -Eq '(^|[[:space:]])--mode([=,[:space:]]|$)'";
  const supportsStreamingPrint =
    "pi --help 2>&1 | grep -Eq '(^|[[:space:]])(-P|--print-streaming)([=,[:space:]]|$)'";
  return runAsAgent(
    `if ${supportsJsonMode}; then ${jsonCommand}; elif ${supportsStreamingPrint}; then ${streamingCommand}; else ${printCommand}; fi`,
    "pi",
    workspacePath,
  );
}

// Kimi (Moonshot AI) CLI. The exact flags are provisional — confirm `-p`/model
// flags against the installed Kimi CLI version before relying on this in prod.
export function buildKimiActionCommand(state: AgentState, workspacePath?: string): string {
  return buildKimiCommand(kimiTaskPrompt(state), workspacePath);
}

export function buildKimiReviewCommand(state: AgentState, workspacePath?: string): string {
  return buildKimiCommand(reviewPrompt(state), workspacePath);
}

// Kimi flags are provisional; ask mode relies on the read-only ask prompt until
// a native read-only flag is confirmed against the installed CLI.
export function buildKimiAskCommand(state: AgentState, workspacePath?: string): string {
  return buildKimiCommand(askPrompt(state), workspacePath);
}

function buildKimiCommand(prompt: string, workspacePath?: string): string {
  const argv = ["kimi"];
  const model = kimiModel();
  if (model) argv.push("--model", model);
  // stream-json emits one JSON message object per stdout line (parsed by
  // KimiStreamRenderer) and keeps thinking + the resume notice off stdout.
  argv.push("--output-format", "stream-json", "--prompt", prompt);
  return runAsAgent(shellCommand(argv), "kimi", workspacePath);
}

export function buildPiPreflightCommand(): string {
  const listModelsArgv = ["pi", "--list-models"];
  const provider = piProvider();
  const model = piModel();
  let modelCheck: string;
  if (model) {
    listModelsArgv.push(`${provider} ${model}`);
    const listModelsCommand = shellCommand(listModelsArgv);
    const modelRowPattern = shellQuote(
      `^${escapeRegExp(provider)}[[:space:]]+${escapeRegExp(model)}([[:space:]]|$)`,
    );
    modelCheck = [
      `model_output=$(${listModelsCommand} 2>&1)`,
      'printf "%s\\n" "$model_output"',
      `printf "%s\\n" "$model_output" | grep -E ${modelRowPattern}`,
    ].join("; ");
  } else {
    modelCheck = shellCommand(listModelsArgv);
  }
  return runAsAgent(["node --version", "command -v pi", "pi --version", modelCheck].join(" && "), "pi");
}
