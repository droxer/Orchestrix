import type { AgentName } from "../types";

type AgentMarkProps = {
  agent: AgentName;
  size?: number;
  className?: string;
};

// Distinctive monoline brand glyphs for each agent. Each shape is drawn on a
// 24-unit grid with a 1.75 stroke so they sit cleanly inside the round
// .agent-avatar chip and feel like deliberate marks rather than letter stubs.
export function AgentMark({ agent, size = 16, className }: AgentMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {agent === "claude" ? <ClaudePaths /> : null}
      {agent === "pi" ? <PiPaths /> : null}
      {agent === "codex" ? <CodexPaths /> : null}
      {agent === "kimi" ? <KimiPaths /> : null}
    </svg>
  );
}

// Claude — a four-point starburst, the "reasoning spark".
function ClaudePaths() {
  return (
    <>
      <path d="M12 3.5 L13.6 10.4 L20.5 12 L13.6 13.6 L12 20.5 L10.4 13.6 L3.5 12 L10.4 10.4 Z" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </>
  );
}

// Pi — the lowercase pi glyph, redrawn as a geometric construction with
// the canonical horizontal bar and two descending legs.
function PiPaths() {
  return (
    <>
      <path d="M4.5 7.5 H19.5" />
      <path d="M9 7.5 V15.5 C9 16.6 8.4 17.5 7.3 17.5 C6.5 17.5 6 17 5.7 16.3" />
      <path d="M15 7.5 V15.5 C15 16.6 15.6 17.5 16.7 17.5 C17.5 17.5 18 17 18.3 16.3" />
    </>
  );
}

// Codex — angle brackets with a thin underline. Reads as "review the code".
function CodexPaths() {
  return (
    <>
      <path d="M9.5 7.5 L4.5 12 L9.5 16.5" />
      <path d="M14.5 7.5 L19.5 12 L14.5 16.5" />
      <path d="M7 20 H17" />
    </>
  );
}

// Kimi — a waxing crescent with a small accent dot. Reads as "K" / moon.
function KimiPaths() {
  return (
    <>
      <path d="M15 4.5 A8.5 8.5 0 1 0 15 19.5 A6.5 6.5 0 0 1 15 4.5 Z" />
      <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  );
}
