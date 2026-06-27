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

export function buildCodexReviewCommand(state: AgentState): string {
  const argv = [...codexBaseArgv(), reviewPrompt(state)];
  return runAsAgent(shellCommand(argv), "codex");
}

export function buildCodexActionCommand(state: AgentState): string {
  const argv = [...codexBaseArgv(), codexActionPrompt(state)];
  return runAsAgent(shellCommand(argv), "codex");
}

export function buildCodexAskCommand(state: AgentState): string {
  const argv = [...codexBaseArgv({ readOnly: true }), askPrompt(state)];
  return runAsAgent(shellCommand(argv), "codex");
}

function codexBaseArgv({ readOnly = false }: { readOnly?: boolean } = {}): string[] {
  const workspace = agentWorkspacePath();
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
      ? ["--sandbox", "read-only", "--ask-for-approval", "never"]
      : ["--dangerously-bypass-approvals-and-sandbox"]),
  ];
  const model = openaiModel();
  if (model) argv.push("-m", model);
  return argv;
}

export function buildClaudeActionCommand(state: AgentState): string {
  return buildClaudeCommand(claudeTaskPrompt(state));
}

export function buildClaudeReviewCommand(state: AgentState): string {
  return buildClaudeCommand(reviewPrompt(state));
}

export function buildClaudeAskCommand(state: AgentState): string {
  // Plan mode runs Claude read-only: it can inspect the workspace but cannot
  // edit files, so it answers the question without making changes.
  return buildClaudeCommand(askPrompt(state), { permissionMode: "plan" });
}

function buildClaudeCommand(
  prompt: string,
  { permissionMode = "bypassPermissions" }: { permissionMode?: string } = {},
): string {
  const workspace = agentWorkspacePath();
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
  return runAsAgent(shellCommand(argv), "claude");
}

export function buildPiActionCommand(state: AgentState): string {
  return buildPiCommand(piTaskPrompt(state));
}

export function buildPiReviewCommand(state: AgentState): string {
  return buildPiCommand(reviewPrompt(state));
}

// Pi has no confirmed native read-only flag yet, so ask mode relies on the
// read-only ask prompt. Tighten with a CLI flag once one is confirmed.
export function buildPiAskCommand(state: AgentState): string {
  return buildPiCommand(askPrompt(state));
}

function buildPiCommand(prompt: string): string {
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
  );
}

// Kimi (Moonshot AI) CLI. The exact flags are provisional — confirm `-p`/model
// flags against the installed Kimi CLI version before relying on this in prod.
export function buildKimiActionCommand(state: AgentState): string {
  return buildKimiCommand(kimiTaskPrompt(state));
}

export function buildKimiReviewCommand(state: AgentState): string {
  return buildKimiCommand(reviewPrompt(state));
}

// Kimi flags are provisional; ask mode relies on the read-only ask prompt until
// a native read-only flag is confirmed against the installed CLI.
export function buildKimiAskCommand(state: AgentState): string {
  return buildKimiCommand(askPrompt(state));
}

function buildKimiCommand(prompt: string): string {
  const argv = ["kimi"];
  const model = kimiModel();
  if (model) argv.push("--model", model);
  argv.push("--prompt", prompt);
  return runAsAgent(shellCommand(argv), "kimi");
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
