import { piModel, piProvider } from "./env.js";
import { codexCliConfigOverrides, runAsAgent } from "./guest.js";
import {
  claudeTaskPrompt,
  codexImplementPrompt,
  codexReviewPrompt,
  piTaskPrompt,
} from "./prompts.js";
import { escapeRegExp, shellCommand, shellQuote } from "./shell.js";
import { GUEST_WORKSPACE, type AgentState } from "./state.js";

export function buildCodexReviewCommand(state: AgentState): string {
  return buildCodexCommand(codexReviewPrompt(state));
}

export function buildCodexImplementCommand(state: AgentState): string {
  return buildCodexCommand(codexImplementPrompt(state));
}

function buildCodexCommand(prompt: string): string {
  const argv = [
    "stdbuf",
    "-oL",
    "-eL",
    "codex",
    ...codexCliConfigOverrides(),
    "-C",
    GUEST_WORKSPACE,
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
  ];
  if (process.env.OPENAI_MODEL) argv.push("-m", process.env.OPENAI_MODEL);
  argv.push(prompt);
  return runAsAgent(shellCommand(argv));
}

export function buildClaudeImplementCommand(state: AgentState): string {
  const argv = [
    "stdbuf",
    "-oL",
    "-eL",
    "claude",
    "-p",
    "--permission-mode",
    "bypassPermissions",
    "--add-dir",
    GUEST_WORKSPACE,
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
  ];
  if (process.env.ANTHROPIC_MODEL) argv.push("--model", process.env.ANTHROPIC_MODEL);
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
