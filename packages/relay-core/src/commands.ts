import { anthropicModel, openaiModel, piModel, piProvider } from "./env.js";
import { agentWorkspacePath, codexCliConfigOverrides, runAsAgent } from "./guest.js";
import {
  claudeTaskPrompt,
  codexImplementPrompt,
  codexReviewPrompt,
  kimiTaskPrompt,
  piTaskPrompt,
} from "./prompts.js";
import { kimiModel } from "./env.js";
import { escapeRegExp, shellCommand, shellQuote } from "./shell.js";
import type { AgentState } from "./state.js";

export function buildCodexReviewCommand(state: AgentState): string {
  const argv = [...codexBaseArgv(), codexReviewPrompt(state)];
  return runAsAgent(shellCommand(argv));
}

export function buildCodexImplementCommand(state: AgentState): string {
  const argv = [...codexBaseArgv(), codexImplementPrompt(state)];
  return runAsAgent(shellCommand(argv));
}

function codexBaseArgv(): string[] {
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
    "--dangerously-bypass-approvals-and-sandbox",
  ];
  const model = openaiModel();
  if (model) argv.push("-m", model);
  return argv;
}

export function buildClaudeImplementCommand(state: AgentState): string {
  const workspace = agentWorkspacePath();
  const argv = [
    "stdbuf",
    "-oL",
    "-eL",
    "claude",
    "-p",
    "--permission-mode",
    "bypassPermissions",
    "--add-dir",
    workspace,
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
  ];
  const model = anthropicModel();
  if (model) argv.push("--model", model);
  argv.push(claudeTaskPrompt(state));
  return runAsAgent(shellCommand(argv));
}

export function buildPiImplementCommand(state: AgentState): string {
  const argv = ["stdbuf", "-oL", "-eL", "pi", "--no-session"];
  const provider = piProvider();
  if (provider) argv.push("--provider", provider);
  const model = piModel();
  if (model) argv.push("--model", model);
  const prompt = piTaskPrompt(state);
  const streamingCommand = shellCommand([...argv, "-P", prompt]);
  const printCommand = shellCommand([...argv, "-p", prompt]);
  const supportsStreamingPrint =
    "pi --help 2>&1 | grep -Eq '(^|[[:space:]])(-P|--print-streaming)([=,[:space:]]|$)'";
  return runAsAgent(
    `if ${supportsStreamingPrint}; then ${streamingCommand}; else ${printCommand}; fi`,
  );
}

// Kimi (Moonshot AI) CLI. The exact flags are provisional — confirm `-p`/model
// flags against the installed Kimi CLI version before relying on this in prod.
export function buildKimiImplementCommand(state: AgentState): string {
  const argv = ["stdbuf", "-oL", "-eL", "kimi", "-p"];
  const model = kimiModel();
  if (model) argv.push("--model", model);
  argv.push(kimiTaskPrompt(state));
  return runAsAgent(shellCommand(argv));
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
  return runAsAgent(["node --version", "command -v pi", "pi --version", modelCheck].join(" && "));
}
