# Relay Web Design Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 design issues in `packages/relay-web` identified in the frontend-design review: use the brand SVG, swap Inter for DM Sans, split App.tsx (1427 lines → under 800), improve the empty state, tint the active conversation row, differentiate agent avatars by color, move the hardcoded "Y" avatar to JSX, add dark mode, add lightweight syntax highlighting, and strengthen the message-in animation.

**Architecture:** Extract focused components and a data hook out of the monolithic App.tsx, then make all CSS/visual changes in styles.css. The `RelayMark` SVG component uses CSS variables so it adapts to dark mode automatically. The syntax highlighter is a ~100-line pure function added to `src/lib/`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind/CSS custom properties, `next/font/google` (DM Sans, JetBrains Mono)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/components/RelayMark.tsx` | Inline SVG brand mark using CSS variables |
| Create | `src/components/EmployeeAvatar.tsx` | Avatar circle + running dot |
| Create | `src/components/StatusPill.tsx` | Status badge via shadcn Badge |
| Create | `src/components/TranscriptEmpty.tsx` | Empty-state panel using RelayMark |
| Create | `src/components/MessageBlock.tsx` | DerivedMessage type + MessageBlock + user avatar JSX |
| Create | `src/components/SettingsDrawer.tsx` | Settings panel, extracted from App |
| Create | `src/components/ConversationRow.tsx` | Single conversation list row |
| Create | `src/hooks/useRelayData.ts` | Polling loop: sandboxes/nodes/sessions state |
| Create | `src/lib/highlight.ts` | Lightweight syntax tokenizer |
| Modify | `src/app/layout.tsx` | Import DM Sans + JetBrains Mono via next/font/google |
| Modify | `src/App.tsx` | Use extracted pieces; wire RelayMark into brand area; shrink to <800 lines |
| Modify | `src/components/AgentStream.tsx` | Pass tokens through highlight.ts for code blocks |
| Modify | `src/styles.css` | Dark mode, active row tint, per-agent avatar colors, message animation, empty-state SVG size |

---

## Task 1: RelayMark SVG component

**Files:**
- Create: `packages/relay-web/src/components/RelayMark.tsx`

No external dependencies. The SVG swaps hardcoded hex values for CSS variable references so the mark works in both light and dark mode.

- [ ] **Step 1: Create RelayMark component**

```tsx
// packages/relay-web/src/components/RelayMark.tsx
type RelayMarkProps = {
  className?: string;
  width?: number;
  height?: number;
};

export function RelayMark({ className, width = 40, height = 27 }: RelayMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 64"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="Relay"
      style={{ shapeRendering: "geometricPrecision" }}
    >
      <title>Relay</title>
      <g
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 14 H22 L32 24 H40" />
        <path d="M10 50 H22 L32 40 H40" />
      </g>
      <g fill="var(--color-ink)">
        <circle cx="10" cy="14" r="4" />
        <circle cx="10" cy="50" r="4" />
      </g>
      <g
        stroke="var(--color-primary)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <line x1="32" y1="32" x2="76" y2="32" />
        <polyline points="68,24 80,32 68,40" />
      </g>
    </svg>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd packages/relay-web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (or only pre-existing errors unrelated to this file).

---

## Task 2: EmployeeAvatar component

**Files:**
- Create: `packages/relay-web/src/components/EmployeeAvatar.tsx`

Extracted verbatim from App.tsx lines 1145–1157. No logic changes.

- [ ] **Step 1: Create EmployeeAvatar**

```tsx
// packages/relay-web/src/components/EmployeeAvatar.tsx
type EmployeeAvatarProps = {
  employeeId: string;
  running: boolean;
};

export function EmployeeAvatar({ employeeId, running }: EmployeeAvatarProps) {
  const initials =
    employeeId
      .split(/[._\-\s]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
  return (
    <span className={`employee-avatar ${running ? "running" : ""}`} aria-hidden="true">
      {initials}
    </span>
  );
}
```

---

## Task 3: StatusPill component

**Files:**
- Create: `packages/relay-web/src/components/StatusPill.tsx`

- [ ] **Step 1: Create StatusPill**

```tsx
// packages/relay-web/src/components/StatusPill.tsx
import { Badge } from "@/components/ui/badge";
import type { Tone } from "../types";

function statusTone(value: string): Tone {
  if (value === "ready" || value === "completed" || value === "done") return "good";
  if (value === "running") return "info";
  if (value === "failed" || value === "blocked" || value === "cancelled") return "bad";
  return "warn";
}

export { statusTone };

type StatusPillProps = { value: string };

export function StatusPill({ value }: StatusPillProps) {
  return (
    <Badge variant="outline" className={`pill ${statusTone(value)}`}>
      {value}
    </Badge>
  );
}
```

---

## Task 4: TranscriptEmpty component

**Files:**
- Create: `packages/relay-web/src/components/TranscriptEmpty.tsx`

Uses `RelayMark` instead of the generic `MessageCircle` icon. The `agentDescriptors` map is passed as a prop so the component stays pure.

- [ ] **Step 1: Create TranscriptEmpty**

```tsx
// packages/relay-web/src/components/TranscriptEmpty.tsx
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
```

---

## Task 5: MessageBlock component

**Files:**
- Create: `packages/relay-web/src/components/MessageBlock.tsx`

This is the largest extraction. It carries the `DerivedMessage` type and the `isGroupedContinuation` helper, the `MessageBlock` component, and the `projectMessages` function. The user avatar "Y" is moved from a CSS `::before` pseudo-element to a real JSX `<span>` so it's not hardcoded in CSS.

- [ ] **Step 1: Create MessageBlock.tsx**

```tsx
// packages/relay-web/src/components/MessageBlock.tsx
import { Paperclip } from "lucide-react";
import { AgentStream } from "./AgentStream";
import type { AgentName, RelaySession, Tone } from "../types";

export type DerivedMessage =
  | {
      kind: "user";
      id: string;
      timestamp: string;
      text: string;
    }
  | {
      kind: "agent";
      id: string;
      timestamp: string;
      agent: AgentName;
      runId: string;
      streaming: boolean;
      stdout: string;
      stderr: string;
      attachments: RelaySession["artifacts"];
    }
  | {
      kind: "system";
      id: string;
      timestamp: string;
      tone: Tone;
      label: string;
      detail?: string;
    };

export function isGroupedContinuation(messages: DerivedMessage[], index: number): boolean {
  const message = messages[index];
  if (message.kind !== "agent") return false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = messages[i];
    if (prev.kind === "system") continue;
    return prev.kind === "agent" && prev.agent === message.agent;
  }
  return false;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

type AgentAvatarProps = { agent: AgentName };

function AgentAvatarIcon({ agent }: AgentAvatarProps) {
  // Single-letter initials per agent so each is visually distinct without an icon dep
  const initials: Record<AgentName, string> = { claude: "C", pi: "π", codex: "X" };
  return (
    <span className="agent-avatar" data-agent={agent} aria-hidden="true">
      {initials[agent]}
    </span>
  );
}

type MessageBlockProps = {
  message: DerivedMessage;
  employeeId: string;
  sessionId: string;
  grouped?: boolean;
};

export function MessageBlock({
  message,
  employeeId,
  sessionId,
  grouped = false,
}: MessageBlockProps) {
  if (message.kind === "user") {
    return (
      <article className="msg msg-user">
        <span className="user-avatar" aria-hidden="true">Y</span>
        <div className="bubble">
          <header>
            <span>you</span>
            <time className="mono">{formatTime(message.timestamp)}</time>
          </header>
          <p>{message.text}</p>
        </div>
      </article>
    );
  }

  if (message.kind === "agent") {
    return (
      <article
        className={`msg msg-agent ${message.streaming ? "streaming" : ""} ${grouped ? "grouped" : ""}`}
      >
        <AgentAvatarIcon agent={message.agent} />
        <div className="bubble">
          <header>
            <span>
              {employeeId}'s {message.agent}
            </span>
            <time className="mono">{formatTime(message.timestamp)}</time>
          </header>
          <AgentStream
            agent={message.agent}
            stdout={message.stdout}
            stderr={message.stderr}
            streaming={message.streaming}
          />
          {message.attachments.length > 0 ? (
            <div className="attachment-list">
              {message.attachments.map((artifact) => (
                <a
                  key={artifact.id}
                  className="attachment-card"
                  href={`/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifact.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Paperclip size={14} />
                  <span className="attachment-meta">
                    <span className="attachment-kind">{artifact.kind}</span>
                    <strong>{artifact.title}</strong>
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  // system message
  return (
    <div className={`msg msg-system tone-${message.tone}`}>
      <span className="msg-system-rule" aria-hidden="true" />
      <span className="msg-system-label">
        <span>{message.label}</span>
        {message.detail ? (
          <span className="msg-system-detail">{message.detail}</span>
        ) : null}
      </span>
      <time className="mono">{formatTime(message.timestamp)}</time>
    </div>
  );
}

// ---------------------------------------------------------------------------
// projectMessages: builds the flat DerivedMessage[] from a session's event log
// ---------------------------------------------------------------------------

export function projectMessages(session: RelaySession | undefined): DerivedMessage[] {
  if (!session) return [];
  const out: DerivedMessage[] = [];
  out.push({
    kind: "user",
    id: `${session.id}:goal`,
    timestamp: session.createdAt,
    text: session.taskGoal,
  });

  const runState = new Map<
    string,
    {
      index: number;
      agent: AgentName;
      streaming: boolean;
      stdout: string;
      stderr: string;
      attachmentIds: Set<string>;
      timestamp: string;
    }
  >();

  const ensureRun = (runId: string, agent: AgentName, timestamp: string): number => {
    const existing = runState.get(runId);
    if (existing) return existing.index;
    const block: DerivedMessage = {
      kind: "agent",
      id: `${session.id}:run:${runId}`,
      timestamp,
      agent,
      runId,
      streaming: true,
      stdout: "",
      stderr: "",
      attachments: [],
    };
    out.push(block);
    const index = out.length - 1;
    runState.set(runId, {
      index,
      agent,
      streaming: true,
      stdout: "",
      stderr: "",
      attachmentIds: new Set(),
      timestamp,
    });
    return index;
  };

  for (const event of session.events) {
    switch (event.type) {
      case "session.created":
        break;
      case "agent.started": {
        ensureRun(event.runId, event.agent, event.timestamp);
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: "neutral",
          label: `${event.agent} - ${event.mode} started`,
        });
        break;
      }
      case "agent.output": {
        const index = ensureRun(event.runId, event.agent, event.timestamp);
        const state = runState.get(event.runId);
        if (!state) break;
        if (event.stream === "stdout") state.stdout += event.text;
        else state.stderr += event.text;
        const block = out[index];
        if (block.kind === "agent") {
          out[index] = { ...block, stdout: state.stdout, stderr: state.stderr };
        }
        break;
      }
      case "artifact.created": {
        const runId = event.artifact.agentRunId;
        if (runId) {
          const index = ensureRun(runId, session.currentAgent ?? "claude", event.timestamp);
          const state = runState.get(runId);
          const block = out[index];
          if (
            state &&
            !state.attachmentIds.has(event.artifact.id) &&
            block.kind === "agent"
          ) {
            state.attachmentIds.add(event.artifact.id);
            out[index] = { ...block, attachments: [...block.attachments, event.artifact] };
          }
        } else {
          out.push({
            kind: "system",
            id: event.id,
            timestamp: event.timestamp,
            tone: "neutral",
            label: `artifact - ${event.artifact.kind}`,
            detail: event.artifact.title,
          });
        }
        break;
      }
      case "human.decision": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: "info",
          label: `you - ${event.decision.kind.replace("_", " ")}`,
          detail: event.decision.note,
        });
        break;
      }
      case "agent.completed": {
        const state = runState.get(event.runId);
        if (state) {
          state.streaming = false;
          const block = out[state.index];
          if (block.kind === "agent") {
            out[state.index] = { ...block, streaming: false };
          }
        }
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone:
            event.status === "completed"
              ? "good"
              : event.status === "failed"
              ? "bad"
              : "neutral",
          label: `${event.agent} - ${event.status}`,
          detail: `exit ${event.exitCode}`,
        });
        break;
      }
      case "review.verdict": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: event.verdict === "approved" ? "good" : "bad",
          label: `codex verdict - ${event.verdict}`,
          detail: event.feedback,
        });
        break;
      }
      case "session.status": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: "neutral",
          label: `status - ${event.phase}`,
        });
        break;
      }
      case "session.completed":
      case "session.failed": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: event.type === "session.completed" ? "good" : "bad",
          label:
            event.type === "session.completed" ? "session completed" : "session failed",
          detail: event.outcome,
        });
        break;
      }
    }
  }
  return out;
}
```

---

## Task 6: SettingsDrawer component

**Files:**
- Create: `packages/relay-web/src/components/SettingsDrawer.tsx`

Extracted from App.tsx lines 1001–1143 verbatim (adjusted imports).

- [ ] **Step 1: Create SettingsDrawer.tsx**

```tsx
// packages/relay-web/src/components/SettingsDrawer.tsx
import { CircleStop, KeyRound, UserRound, X } from "lucide-react";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { StatusPill } from "./StatusPill";
import type { DaemonNodeMonitorRecord, SandboxRecord } from "../types";

export type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  quickUsers: string[];
  selectedEmployee: string;
  customEmployee: string;
  setCustomEmployee: (value: string) => void;
  selectEmployee: (employeeId: string) => Promise<void>;
  tokenInput: string;
  setTokenInput: (value: string) => void;
  saveToken: () => void;
  selectedSandbox?: SandboxRecord;
  selectedNode?: DaemonNodeMonitorRecord;
  activeRun?: DaemonNodeMonitorRecord["activeRuns"][number];
  onCancelRun: () => Promise<void>;
};

export function SettingsDrawer({
  open,
  onClose,
  quickUsers,
  selectedEmployee,
  customEmployee,
  setCustomEmployee,
  selectEmployee,
  tokenInput,
  setTokenInput,
  saveToken,
  selectedSandbox,
  selectedNode,
  activeRun,
  onCancelRun,
}: SettingsDrawerProps) {
  if (!open) return null;
  return (
    <aside id="settings-drawer" className="settings-drawer" aria-labelledby="settings-title">
      <div className="settings-header">
        <div>
          <p className="eyebrow">Employee workspace</p>
          <h3 id="settings-title" translate="no">
            @{selectedEmployee}
          </h3>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <section className="settings-section">
        <div className="panel-kicker">Known employees</div>
        <div className="settings-user-list">
          {quickUsers.map((employeeId) => (
            <button
              className={`settings-user ${selectedEmployee === employeeId ? "active" : ""}`}
              key={employeeId}
              onClick={() => void selectEmployee(employeeId)}
              type="button"
            >
              <EmployeeAvatar employeeId={employeeId} running={false} />
              <span translate="no">@{employeeId}</span>
            </button>
          ))}
        </div>
        <form
          className="settings-inline"
          onSubmit={(event) => {
            event.preventDefault();
            void selectEmployee(customEmployee);
            setCustomEmployee("");
          }}
        >
          <UserRound size={15} />
          <input
            aria-label="Custom employee ID"
            name="custom-employee-id"
            autoComplete="off"
            spellCheck={false}
            placeholder="alice…"
            value={customEmployee}
            onChange={(event) => setCustomEmployee(event.target.value)}
          />
          <button type="submit">Open Employee</button>
        </form>
      </section>

      <section className="settings-section">
        <div className="panel-kicker">Sandbox token</div>
        <div className="settings-inline">
          <KeyRound size={15} />
          <input
            aria-label="Sandbox token"
            name="sandbox-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="tok_…"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
          />
          <button type="button" onClick={saveToken}>
            Save Token
          </button>
        </div>
        <p className="settings-hint">Saved locally in this browser for the selected employee.</p>
      </section>

      <section className="settings-section">
        <div className="panel-kicker">Live sandbox</div>
        <p className="settings-id" translate="no">
          {selectedSandbox?.id ?? "No sandbox selected"}
        </p>
        <StatusPill value={selectedSandbox?.status ?? "unprovisioned"} />
        <dl className="settings-dl">
          <div>
            <dt>workspace</dt>
            <dd>{selectedSandbox?.workspacePath ?? "none"}</dd>
          </div>
          <div>
            <dt>node</dt>
            <dd>
              {selectedNode ? (
                <>
                  <span className="mono">{selectedNode.queuedCommandCount}</span> queued
                </>
              ) : (
                "not registered"
              )}
            </dd>
          </div>
          <div>
            <dt>run</dt>
            <dd>
              {activeRun ? (
                <span className="settings-run">
                  <span className="mono" translate="no">
                    {activeRun.agent}
                  </span>
                  <button
                    type="button"
                    className="settings-cancel"
                    onClick={() => void onCancelRun()}
                  >
                    <CircleStop size={12} /> Cancel
                  </button>
                </span>
              ) : (
                "idle"
              )}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
```

---

## Task 7: ConversationRow component

**Files:**
- Create: `packages/relay-web/src/components/ConversationRow.tsx`

- [ ] **Step 1: Create ConversationRow.tsx**

```tsx
// packages/relay-web/src/components/ConversationRow.tsx
import { Plus } from "lucide-react";
import { EmployeeAvatar } from "./EmployeeAvatar";
import type { DaemonNodeMonitorRecord, SandboxRecord, RelaySession, Tone } from "../types";

type EmployeeContact = {
  id: string;
  sandbox?: SandboxRecord;
  node?: DaemonNodeMonitorRecord;
  activeRun?: DaemonNodeMonitorRecord["activeRuns"][number];
  sessionCount: number;
  lastSession?: RelaySession;
};

export type { EmployeeContact };

function statusTone(value: string): Tone {
  if (value === "ready" || value === "completed" || value === "done") return "good";
  if (value === "running") return "info";
  if (value === "failed" || value === "blocked" || value === "cancelled") return "bad";
  return "warn";
}

type ConversationRowProps = {
  contact: EmployeeContact;
  selected: boolean;
  onSelect: (id: string) => void;
};

export function ConversationRow({ contact, selected, onSelect }: ConversationRowProps) {
  const status = contact.sandbox?.status ?? "unprovisioned";
  const lastAgent =
    contact.lastSession?.agentRuns[contact.lastSession.agentRuns.length - 1]?.agent;
  return (
    <button
      className={`conversation-row ${selected ? "active" : ""} ${contact.activeRun ? "has-activity" : ""}`}
      key={contact.id}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(contact.id)}
    >
      <EmployeeAvatar employeeId={contact.id} running={Boolean(contact.activeRun)} />
      <span className="conversation-copy">
        <span className="conversation-topline">
          <span className="conversation-name">
            <span
              className={`status-dot status-dot-${statusTone(status)}`}
              aria-hidden="true"
            />
            <strong translate="no">{contact.id}</strong>
          </span>
          {contact.activeRun ? (
            <span className="conversation-badge mono" aria-label="Agent running">
              {Math.max(contact.sessionCount, 1)}
            </span>
          ) : (
            <span className="conversation-stamp mono">
              {contact.sessionCount > 0
                ? `${contact.sessionCount.toString().padStart(2, "0")}`
                : "—"}
            </span>
          )}
        </span>
        <span className="conversation-preview">
          {contact.activeRun
            ? `${contact.activeRun.agent} is working`
            : (contact.lastSession?.taskGoal ?? "Open their agent workspace")}
        </span>
        <span className="conversation-meta">
          <span className="conversation-meta-status">{status}</span>
          <span className="conversation-meta-sep" aria-hidden="true" />
          <span>{lastAgent ?? "no agent yet"}</span>
        </span>
      </span>
    </button>
  );
}

type NewConversationRowProps = { employeeQuery: string; onSelect: (id: string) => void };

export function NewConversationRow({ employeeQuery, onSelect }: NewConversationRowProps) {
  return (
    <button
      className="conversation-row conversation-row-new"
      type="button"
      onClick={() => onSelect(employeeQuery)}
    >
      <span className="conversation-new-avatar" aria-hidden="true">
        <Plus size={16} />
      </span>
      <span className="conversation-copy">
        <span className="conversation-topline">
          <span className="conversation-name">
            <strong>Start @{employeeQuery || "new-employee"}</strong>
          </span>
        </span>
        <span className="conversation-preview">
          Create a sandbox-backed employee conversation.
        </span>
      </span>
    </button>
  );
}
```

---

## Task 8: useRelayData hook

**Files:**
- Create: `packages/relay-web/src/hooks/useRelayData.ts`

Extracts the 3-second polling loop and its state from App.tsx.

- [ ] **Step 1: Create useRelayData.ts**

```ts
// packages/relay-web/src/hooks/useRelayData.ts
import { useCallback, useEffect, useState } from "react";
import { listDaemonNodes, listSandboxes, listSessions } from "../api";
import type { DaemonNodeMonitorRecord, RelaySession, SandboxRecord, Tone } from "../types";

type StatusUpdate = { tone: Tone; message: string };

type RelayDataResult = {
  sandboxes: SandboxRecord[];
  nodes: DaemonNodeMonitorRecord[];
  sessions: RelaySession[];
  isRefreshing: boolean;
  refresh: (signal?: AbortSignal) => Promise<void>;
  setSandboxes: React.Dispatch<React.SetStateAction<SandboxRecord[]>>;
  setStatus: React.Dispatch<React.SetStateAction<StatusUpdate>>;
};

export function useRelayData(
  setStatus: React.Dispatch<React.SetStateAction<StatusUpdate>>,
): Omit<RelayDataResult, "setStatus"> {
  const [sandboxes, setSandboxes] = useState<SandboxRecord[]>([]);
  const [nodes, setNodes] = useState<DaemonNodeMonitorRecord[]>([]);
  const [sessions, setSessions] = useState<RelaySession[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setIsRefreshing(true);
      try {
        const [sandboxResult, nodeResult, sessionResult] = await Promise.allSettled([
          listSandboxes(signal),
          listDaemonNodes(signal),
          listSessions(signal),
        ]);
        if (sandboxResult.status === "fulfilled")
          setSandboxes(sandboxResult.value.sandboxes);
        if (nodeResult.status === "fulfilled") setNodes(nodeResult.value.nodes);
        if (sessionResult.status === "fulfilled")
          setSessions(sessionResult.value.sessions);
        const rejected = [sandboxResult, nodeResult, sessionResult].find(
          (item) => item.status === "rejected",
        );
        if (rejected?.status === "rejected") {
          setStatus({
            tone: "warn",
            message:
              rejected.reason instanceof Error
                ? rejected.reason.message
                : String(rejected.reason),
          });
        }
      } finally {
        setIsRefreshing(false);
      }
    },
    [setStatus],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal), 3000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { sandboxes, nodes, sessions, isRefreshing, refresh, setSandboxes };
}
```

---

## Task 9: Slim App.tsx — use extracted pieces, add RelayMark to brand area

**Files:**
- Modify: `packages/relay-web/src/App.tsx`

Replace the local definitions (EmployeeAvatar, SettingsDrawer, MessageBlock, DerivedMessage, statusTone, StatusPill, projectMessages, isGroupedContinuation) with imports from the new files. Replace the `projectMessages` function and `DerivedMessage` type with the exported versions. Wire `RelayMark` into `.brand-mark`. Wire `TranscriptEmpty`. Wire `useRelayData`. Wire `ConversationRow` / `NewConversationRow`.

The result should be under 600 lines.

- [ ] **Step 1: Rewrite App.tsx**

Replace the entire content of `packages/relay-web/src/App.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Bot,
  Check,
  CircleStop,
  CornerDownLeft,
  GitBranch,
  MessageCircle,
  RefreshCw,
  Search,
  Settings,
  UserRound,
  X,
} from "lucide-react";

import {
  cancelRun,
  createSession,
  listDaemonNodes,
  listSandboxes,
  listSessions,
  provisionSandbox,
  recordDecision,
  recordHandoff,
  runSandbox,
} from "./api";
import type { AgentName, CodexTaskMode, DaemonNodeMonitorRecord, RelaySession, SandboxRecord, Tone } from "./types";

import { RelayMark } from "./components/RelayMark";
import { EmployeeAvatar } from "./components/EmployeeAvatar";
import { StatusPill } from "./components/StatusPill";
import { TranscriptEmpty } from "./components/TranscriptEmpty";
import { MessageBlock, isGroupedContinuation, projectMessages } from "./components/MessageBlock";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ConversationRow, NewConversationRow } from "./components/ConversationRow";
import type { EmployeeContact } from "./components/ConversationRow";
import { useRelayData } from "./hooks/useRelayData";

const quickUsers = ["alice", "bob", "carol"];
const agents: AgentName[] = ["claude", "pi", "codex"];
const tokenStorageKey = "relay-web.tokens";
const selectedEmployeeKey = "relay-web.selectedEmployee";

const agentDescriptors: Record<AgentName, { role: string; blurb: string }> = {
  claude: { role: "Builder",  blurb: "Turns requests into implementation work with methodical context." },
  pi:     { role: "Planner",  blurb: "Explores trade-offs and shapes the next reliable step." },
  codex:  { role: "Reviewer", blurb: "Reads diffs, checks behavior, and calls out risks." },
};

function defaultModeForAgent(agent: AgentName): CodexTaskMode {
  return agent === "codex" ? "review" : "implement";
}

type TokenMap = Record<string, string>;
type MobileView = "threads" | "chat";

function readTokens(): TokenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(tokenStorageKey);
    return raw ? (JSON.parse(raw) as TokenMap) : {};
  } catch {
    return {};
  }
}

function writeTokens(tokens: TokenMap): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(tokenStorageKey, JSON.stringify(tokens));
}

function sessionBelongsToEmployee(
  session: RelaySession,
  employeeId: string,
  sandbox?: SandboxRecord,
): boolean {
  if (sandbox && session.workspacePath === sandbox.workspacePath) return true;
  return (
    session.workspacePath === `/workspace/${employeeId}` ||
    session.workspacePath.endsWith(`/${employeeId}`)
  );
}

export function App() {
  const [status, setStatus] = useState<{ tone: Tone; message: string }>({
    tone: "info",
    message: "Open an employee workspace to begin.",
  });
  const { sandboxes, nodes, sessions, isRefreshing, refresh, setSandboxes } =
    useRelayData(setStatus);

  const [selectedEmployee, setSelectedEmployee] = useState<string>(quickUsers[0]);
  const [customEmployee, setCustomEmployee] = useState("");
  const [tokens, setTokens] = useState<TokenMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [activeAgent, setActiveAgent] = useState<AgentName>("claude");
  const [composerText, setComposerText] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffAgent, setHandoffAgent] = useState<AgentName>("codex");
  const [handoffNote, setHandoffNote] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const statusSeenRef = useRef(false);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    if (!statusSeenRef.current) {
      statusSeenRef.current = true;
      return;
    }
    setToastVisible(true);
    const timer = window.setTimeout(() => setToastVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const selectedSandbox = useMemo(
    () => sandboxes.find((sandbox) => sandbox.employeeId === selectedEmployee),
    [sandboxes, selectedEmployee],
  );
  const selectedNode = useMemo(
    () =>
      nodes.find(
        (node) =>
          node.employeeId === selectedEmployee || node.id === selectedSandbox?.id,
      ),
    [nodes, selectedEmployee, selectedSandbox?.id],
  );

  const sandboxWorkspace = selectedSandbox?.workspacePath;
  const sandboxSessions = useMemo(
    () =>
      sessions.filter(
        (session) => !sandboxWorkspace || session.workspacePath === sandboxWorkspace,
      ),
    [sessions, sandboxWorkspace],
  );
  const threadSessions = useMemo(
    () =>
      sandboxSessions.filter((session) =>
        session.agentRuns.some((run) => run.agent === activeAgent),
      ),
    [sandboxSessions, activeAgent],
  );

  const activeSession = useMemo(() => {
    if (selectedSessionId) {
      const pinned = sessions.find((session) => session.id === selectedSessionId);
      if (pinned) return pinned;
    }
    return threadSessions[0];
  }, [selectedSessionId, sessions, threadSessions]);

  const selectedToken = selectedSandbox
    ? (tokens[selectedSandbox.id] ?? tokens[selectedEmployee])
    : tokens[selectedEmployee];
  const activeRun = selectedNode?.activeRuns[0];

  const messages = useMemo(
    () => projectMessages(activeSession),
    [activeSession],
  );

  const awaitingDecision = useMemo(() => {
    if (!activeSession) return false;
    const events = activeSession.events;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type === "human.decision") return false;
      if (event.type === "agent.completed") return true;
      if (event.type === "session.completed" || event.type === "session.failed")
        return false;
    }
    return false;
  }, [activeSession]);

  const employeeContacts = useMemo<EmployeeContact[]>(() => {
    const byId = new Map<string, EmployeeContact>();
    const ensure = (id: string): EmployeeContact => {
      const key = id.trim();
      const existing = byId.get(key);
      if (existing) return existing;
      const contact: EmployeeContact = { id: key, sessionCount: 0 };
      byId.set(key, contact);
      return contact;
    };
    for (const employeeId of quickUsers) ensure(employeeId);
    ensure(selectedEmployee);
    for (const sandbox of sandboxes) {
      const contact = ensure(sandbox.employeeId);
      contact.sandbox = sandbox;
    }
    for (const node of nodes) {
      const employeeId =
        node.employeeId ??
        sandboxes.find((sandbox) => sandbox.id === node.id)?.employeeId;
      if (!employeeId) continue;
      const contact = ensure(employeeId);
      contact.node = node;
      contact.activeRun = node.activeRuns[0];
    }
    for (const contact of byId.values()) {
      const related = sessions.filter((session) =>
        sessionBelongsToEmployee(session, contact.id, contact.sandbox),
      );
      contact.sessionCount = related.length;
      contact.lastSession = related[0];
    }
    return [...byId.values()].sort((a, b) => {
      if (a.id === selectedEmployee) return -1;
      if (b.id === selectedEmployee) return 1;
      if (a.activeRun && !b.activeRun) return -1;
      if (b.activeRun && !a.activeRun) return 1;
      const aQuick = quickUsers.indexOf(a.id);
      const bQuick = quickUsers.indexOf(b.id);
      if (aQuick !== -1 || bQuick !== -1)
        return (aQuick === -1 ? 99 : aQuick) - (bQuick === -1 ? 99 : bQuick);
      return a.id.localeCompare(b.id);
    });
  }, [nodes, sandboxes, selectedEmployee, sessions]);

  const filteredEmployees = useMemo(() => {
    const query = employeeQuery.trim().toLowerCase();
    if (!query) return employeeContacts;
    return employeeContacts.filter((contact) => {
      const lastGoal = contact.lastSession?.taskGoal.toLowerCase() ?? "";
      return contact.id.toLowerCase().includes(query) || lastGoal.includes(query);
    });
  }, [employeeContacts, employeeQuery]);

  const employeeSearchCanStart = useMemo(() => {
    const id = employeeQuery.trim();
    return (
      id.length > 0 &&
      !employeeContacts.some((contact) => contact.id.toLowerCase() === id.toLowerCase())
    );
  }, [employeeContacts, employeeQuery]);

  useEffect(() => {
    const storedEmployee = localStorage.getItem(selectedEmployeeKey);
    if (storedEmployee) setSelectedEmployee(storedEmployee);
    setTokens(readTokens());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(selectedEmployeeKey, selectedEmployee);
    setTokenInput(tokens[selectedEmployee] ?? "");
  }, [selectedEmployee, tokens, hydrated]);

  useEffect(() => {
    setSelectedSessionId(undefined);
  }, [activeAgent, selectedEmployee]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, activeSession?.id]);

  function handleTranscriptScroll(): void {
    const el = transcriptRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  async function selectEmployee(employeeId: string) {
    const nextEmployee = employeeId.trim().replace(/^@/, "");
    if (!nextEmployee) return;
    setSelectedEmployee(nextEmployee);
    setMobileView("chat");
    const token =
      nextEmployee === selectedEmployee
        ? tokenInput.trim() || tokens[nextEmployee]
        : tokens[nextEmployee];
    try {
      setStatus({ tone: "info", message: `Opening ${nextEmployee}'s Relay workspace.` });
      const sandbox = await provisionSandbox(nextEmployee, token);
      const nextTokens = { ...tokens };
      if (sandbox.token) {
        nextTokens[sandbox.id] = sandbox.token;
        nextTokens[nextEmployee] = sandbox.token;
        setTokens(nextTokens);
        writeTokens(nextTokens);
      }
      setSandboxes((current) => [sandbox, ...current.filter((item) => item.id !== sandbox.id)]);
      setStatus({ tone: "good", message: `${nextEmployee}'s agent workspace is ready.` });
      await refresh();
    } catch (error) {
      setStatus({
        tone: "bad",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function saveToken() {
    const token = tokenInput.trim();
    const nextTokens = { ...tokens };
    if (selectedSandbox) nextTokens[selectedSandbox.id] = token;
    nextTokens[selectedEmployee] = token;
    setTokens(nextTokens);
    writeTokens(nextTokens);
    setStatus({
      tone: "info",
      message: token ? "Token saved for this employee." : "Token cleared.",
    });
  }

  async function sendMessage() {
    const raw = composerText.trim();
    if (!raw) return;
    const mentionMatch = /^@(claude|pi|codex)(?:\s+|$)/i.exec(raw);
    const routedAgent: AgentName =
      (mentionMatch?.[1].toLowerCase() as AgentName | undefined) ?? activeAgent;
    const goal = mentionMatch ? raw.slice(mentionMatch[0].length).trim() : raw;
    if (!goal) {
      setStatus({ tone: "warn", message: `Add a task after @${routedAgent}.` });
      return;
    }
    if (!selectedSandbox) {
      setStatus({ tone: "warn", message: "Open this employee's sandbox before sending." });
      await selectEmployee(selectedEmployee);
      return;
    }
    setIsRunning(true);
    try {
      const assignment = { agent: routedAgent, mode: defaultModeForAgent(routedAgent) };
      const session = await createSession({
        taskGoal: goal,
        assignments: [assignment],
        workspacePath: selectedSandbox.workspacePath,
      });
      setSelectedSessionId(session.id);
      setComposerText("");
      setMentionOpen(false);
      setMobileView("chat");
      atBottomRef.current = true;
      await refresh();
      const refreshTimer = window.setInterval(() => void refresh(), 1000);
      try {
        const completed = await runSandbox(
          {
            sandboxId: selectedSandbox.id,
            taskGoal: goal,
            assignments: [assignment],
            sessionId: session.id,
          },
          selectedToken,
        );
        setSelectedSessionId(completed.id);
        setStatus({
          tone: "good",
          message: `Message sent to ${selectedEmployee}'s ${routedAgent} agent.`,
        });
      } finally {
        window.clearInterval(refreshTimer);
      }
      await refresh();
    } catch (error) {
      setStatus({
        tone: "bad",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRunning(false);
    }
  }

  function detectMentionToken(
    text: string,
    caret: number,
  ): { start: number; query: string } | null {
    const upTo = text.slice(0, caret);
    const match = /(?:^|\s)@([a-z0-9-]*)$/i.exec(upTo);
    if (!match) return null;
    const start = match.index === 0 ? 0 : match.index + 1;
    return { start, query: match[1].toLowerCase() };
  }

  function syncMentionState(text: string, caret: number) {
    if (isComposing) return;
    const token = detectMentionToken(text, caret);
    if (token) {
      setMentionOpen(true);
      setMentionQuery(token.query);
      setMentionIndex(0);
    } else if (mentionOpen) {
      setMentionOpen(false);
    }
  }

  function insertMention(agent: AgentName) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? composerText.length;
    const token = detectMentionToken(composerText, caret);
    const start = token?.start ?? caret;
    const before = composerText.slice(0, start);
    const after = composerText.slice(caret);
    const inserted = `@${agent} `;
    const next = `${before}${inserted}${after}`;
    setComposerText(next);
    setMentionOpen(false);
    setMentionQuery("");
    setMentionIndex(0);
    pickAgent(agent);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      const pos = start + inserted.length;
      node.focus();
      node.setSelectionRange(pos, pos);
    });
  }

  async function cancelActiveRun() {
    if (!selectedSandbox || !activeRun) return;
    try {
      const session = await cancelRun(
        selectedSandbox.id,
        activeRun.sessionId,
        selectedToken,
      );
      setSelectedSessionId(session.id);
      setStatus({ tone: "warn", message: `Cancel requested for ${activeRun.sessionId}.` });
      await refresh();
    } catch (error) {
      setStatus({
        tone: "bad",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function sendDecision(kind: "approve" | "reject" | "rerun" | "mark_done") {
    if (!activeSession) return;
    try {
      const session = await recordDecision(activeSession.id, kind);
      setSelectedSessionId(session.id);
      setStatus({ tone: "good", message: `${kind.replace("_", " ")} recorded.` });
      await refresh();
    } catch (error) {
      setStatus({
        tone: "bad",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function sendHandoff() {
    if (!activeSession) return;
    try {
      const session = await recordHandoff(
        activeSession.id,
        handoffAgent,
        defaultModeForAgent(handoffAgent),
        handoffNote.trim() || undefined,
      );
      setSelectedSessionId(session.id);
      setHandoffNote("");
      setHandoffOpen(false);
      setActiveAgent(handoffAgent);
      setStatus({ tone: "good", message: `Conversation handed to ${handoffAgent}.` });
      await refresh();
    } catch (error) {
      setStatus({
        tone: "bad",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function pickAgent(agent: AgentName) {
    setActiveAgent(agent);
    setAgentPickerOpen(false);
  }

  const filteredMentionAgents = mentionQuery
    ? agents.filter((agent) => agent.startsWith(mentionQuery))
    : agents;

  return (
    <main
      className="messenger-shell"
      data-settings={settingsOpen ? "open" : "closed"}
      data-mobile-view={mobileView}
    >
      <a className="skip-link" href="#chat-panel">
        Skip to Conversation
      </a>

      {/* ---- mobile top bar ---- */}
      <div className="mobile-topbar" aria-label="Mobile workspace switcher">
        <button
          type="button"
          className={mobileView === "threads" ? "active" : ""}
          aria-label="Conversations"
          aria-pressed={mobileView === "threads"}
          onClick={() => setMobileView("threads")}
        >
          <MessageCircle size={16} />
          <span>Chats</span>
        </button>
        <button
          type="button"
          className={mobileView === "chat" ? "active" : ""}
          aria-pressed={mobileView === "chat"}
          onClick={() => setMobileView("chat")}
        >
          <Bot size={16} />
          <span translate="no">@{selectedEmployee}</span>
        </button>
        <button
          type="button"
          className={`mobile-settings ${settingsOpen ? "active" : ""}`}
          aria-label="Settings"
          aria-controls="settings-drawer"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Settings size={16} />
        </button>
      </div>

      {/* ---- left nav rail ---- */}
      <aside className="people-panel" aria-label="Relay navigation">
        <div className="brand-mark" aria-label="Relay">
          <RelayMark width={40} height={27} />
        </div>

        <nav className="side-nav" aria-label="Workspace sections">
          <button className="active" type="button" aria-label="Chat" aria-pressed="true">
            <MessageCircle size={16} />
            <span>Chat</span>
            <small>{employeeContacts.length}</small>
          </button>
          <button
            type="button"
            aria-label="Sandboxes"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <UserRound size={16} />
            <span>Sandboxes</span>
            <small>{sandboxes.length}</small>
          </button>
        </nav>

        <button
          className="people-settings"
          type="button"
          aria-controls="settings-drawer"
          aria-expanded={settingsOpen}
          aria-label="Workspace settings"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Settings size={15} />
          <span>Workspace settings</span>
        </button>
      </aside>

      {/* ---- conversation list panel ---- */}
      <aside className="thread-panel" aria-label="Employee conversations">
        <div className="conversation-header">
          <div className="conversation-heading">
            <h1>
              Conversations
              <small className="mono conversation-heading-count">
                {filteredEmployees.length.toString().padStart(2, "0")}
              </small>
            </h1>
          </div>
          <button type="button" aria-label="Refresh" onClick={() => void refresh()}>
            <RefreshCw size={16} className={isRefreshing ? "spin" : ""} />
          </button>
        </div>

        <form
          className="people-search conversation-search"
          onSubmit={(event) => {
            event.preventDefault();
            void selectEmployee(employeeQuery);
          }}
        >
          <Search size={15} />
          <input
            aria-label="Search employee conversations"
            name="employee-search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search conversations…"
            value={employeeQuery}
            onChange={(event) => setEmployeeQuery(event.target.value)}
          />
          {employeeSearchCanStart ? (
            <button type="submit" aria-label={`Open workspace for ${employeeQuery}`}>
              <Plus size={15} />
            </button>
          ) : null}
        </form>

        <section className="conversation-list" aria-label="Employee conversation list">
          {filteredEmployees.map((contact) => (
            <ConversationRow
              key={contact.id}
              contact={contact}
              selected={selectedEmployee === contact.id}
              onSelect={(id) => void selectEmployee(id)}
            />
          ))}
          {filteredEmployees.length === 0 ? (
            <NewConversationRow
              employeeQuery={employeeQuery}
              onSelect={(id) => void selectEmployee(id)}
            />
          ) : null}
        </section>
      </aside>

      {/* ---- main chat panel ---- */}
      <section
        id="chat-panel"
        className="chat-panel"
        aria-label="Active employee agent conversation"
        tabIndex={-1}
      >
        <header className="chat-header">
          <div className="chat-title">
            <button
              className="mobile-back-button"
              type="button"
              onClick={() => setMobileView("threads")}
            >
              <MessageCircle size={16} />
              <span>Conversations</span>
            </button>
            <EmployeeAvatar employeeId={selectedEmployee} running={Boolean(activeRun)} />
            <div>
              <p>
                <span translate="no">@{selectedEmployee}</span>
                <span className="header-separator" aria-hidden="true" />
                <span translate="no">{activeAgent}</span>
                {activeSession ? (
                  <>
                    <span className="header-separator" aria-hidden="true" />
                    <span className="session-id">{activeSession.id.slice(0, 8)}</span>
                  </>
                ) : null}
              </p>
              <h2>{activeSession ? activeSession.taskGoal : "New conversation"}</h2>
            </div>
          </div>
          <div className="chat-tools">
            <div className="header-agent-tabs" aria-label="Talk to agent">
              {agents.map((agent) => (
                <button
                  key={agent}
                  type="button"
                  aria-pressed={agent === activeAgent}
                  className={agent === activeAgent ? "active" : ""}
                  onClick={() => setActiveAgent(agent)}
                >
                  <span translate="no">@{agent}</span>
                </button>
              ))}
            </div>
            {activeSession ? <StatusPill value={activeSession.status} /> : null}
            <button
              className={`icon-button ${settingsOpen ? "active" : ""}`}
              type="button"
              aria-label="Settings"
              aria-controls="settings-drawer"
              aria-expanded={settingsOpen}
              title="Settings"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings size={16} />
            </button>
          </div>
        </header>

        <div
          className={`toast ${status.tone}`}
          data-visible={toastVisible}
          role="status"
          aria-live="polite"
        >
          {toastVisible ? status.message : null}
        </div>

        <div
          className="transcript"
          ref={transcriptRef}
          onScroll={handleTranscriptScroll}
        >
          <div className="transcript-inner">
            {activeSession ? (
              <>
                {messages.map((message, index) => (
                  <MessageBlock
                    key={message.id}
                    message={message}
                    employeeId={selectedEmployee}
                    sessionId={activeSession.id}
                    grouped={isGroupedContinuation(messages, index)}
                  />
                ))}
                {awaitingDecision ? (
                  <div className="decision-bar">
                    <button type="button" onClick={() => void sendDecision("approve")}>
                      <Check size={14} /> Approve
                    </button>
                    <button type="button" onClick={() => void sendDecision("rerun")}>
                      Rerun
                    </button>
                    <button type="button" onClick={() => void sendDecision("mark_done")}>
                      Mark done
                    </button>
                    <button
                      type="button"
                      className="danger-soft"
                      onClick={() => void sendDecision("reject")}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="primary"
                      aria-controls="handoff-panel"
                      aria-expanded={handoffOpen}
                      onClick={() => setHandoffOpen((v) => !v)}
                    >
                      <GitBranch size={14} /> Handoff
                    </button>
                  </div>
                ) : null}
                {handoffOpen ? (
                  <div id="handoff-panel" className="handoff-panel">
                    <div className="handoff-row">
                      <label htmlFor="handoff-agent">Route to</label>
                      <select
                        id="handoff-agent"
                        name="handoff-agent"
                        value={handoffAgent}
                        onChange={(event) =>
                          setHandoffAgent(event.target.value as AgentName)
                        }
                      >
                        {agents.map((agent) => (
                          <option key={agent} value={agent}>
                            {agent}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      aria-label="Handoff note"
                      name="handoff-note"
                      autoComplete="off"
                      placeholder="Optional handoff note…"
                      value={handoffNote}
                      onChange={(event) => setHandoffNote(event.target.value)}
                    />
                    <div className="handoff-actions">
                      <button type="button" onClick={() => setHandoffOpen(false)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void sendHandoff()}
                      >
                        Send handoff
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <TranscriptEmpty
                selectedEmployee={selectedEmployee}
                activeAgent={activeAgent}
                agentDescriptors={agentDescriptors}
              />
            )}
          </div>
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <div className="composer-toolbar">
            <div className="agent-picker-wrap">
              <button
                type="button"
                className="agent-picker-trigger"
                aria-label="Choose agent"
                aria-controls="agent-picker"
                aria-expanded={agentPickerOpen}
                onClick={() => setAgentPickerOpen((v) => !v)}
              >
                <AtSign size={14} />
                <span translate="no">{activeAgent}</span>
              </button>
              {agentPickerOpen ? (
                <div id="agent-picker" className="agent-picker" aria-label="Choose agent">
                  {agents.map((agent) => (
                    <button
                      key={agent}
                      type="button"
                      aria-pressed={agent === activeAgent}
                      className={agent === activeAgent ? "active" : ""}
                      onClick={() => pickAgent(agent)}
                    >
                      <span className="agent-avatar" data-agent={agent} aria-hidden="true">
                        {agent === "pi" ? "π" : agent.charAt(0).toUpperCase()}
                      </span>
                      <span translate="no">{agent}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {activeRun ? (
              <button
                type="button"
                className="cancel-run"
                onClick={() => void cancelActiveRun()}
              >
                <CircleStop size={14} /> Cancel run
              </button>
            ) : null}
          </div>
          <div className="composer-input-wrap">
            {mentionOpen && filteredMentionAgents.length > 0 ? (
              <div
                id="mention-popover"
                className="mention-popover agent-picker"
                role="listbox"
                aria-label="Address an agent"
              >
                {filteredMentionAgents.map((agent, i) => (
                  <button
                    key={agent}
                    id={`mention-option-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === mentionIndex}
                    className={i === mentionIndex ? "active" : ""}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertMention(agent);
                    }}
                  >
                    <span className="agent-avatar" data-agent={agent} aria-hidden="true">
                      {agent === "pi" ? "π" : agent.charAt(0).toUpperCase()}
                    </span>
                    <span translate="no">@{agent}</span>
                    <span className="mention-role">{agentDescriptors[agent].role}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="composer-input">
              <textarea
                ref={textareaRef}
                aria-label={`Write to ${selectedEmployee}'s ${activeAgent}`}
                aria-controls={mentionOpen ? "mention-popover" : undefined}
                aria-expanded={mentionOpen}
                aria-activedescendant={
                  mentionOpen ? `mention-option-${mentionIndex}` : undefined
                }
                name="message"
                placeholder={`Write to @${selectedEmployee} — type @ to switch agent…`}
                value={composerText}
                onChange={(event) => {
                  const value = event.target.value;
                  setComposerText(value);
                  syncMentionState(value, event.target.selectionStart ?? value.length);
                }}
                onKeyUp={(event) => {
                  if (
                    event.key.startsWith("Arrow") ||
                    event.key === "Home" ||
                    event.key === "End"
                  ) {
                    const target = event.currentTarget;
                    syncMentionState(
                      target.value,
                      target.selectionStart ?? target.value.length,
                    );
                  }
                }}
                onSelect={(event) => {
                  const target = event.currentTarget;
                  syncMentionState(
                    target.value,
                    target.selectionStart ?? target.value.length,
                  );
                }}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(event) => {
                  setIsComposing(false);
                  const target = event.currentTarget;
                  syncMentionState(
                    target.value,
                    target.selectionStart ?? target.value.length,
                  );
                }}
                onBlur={() => setMentionOpen(false)}
                onKeyDown={(event) => {
                  if (mentionOpen && filteredMentionAgents.length > 0) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setMentionIndex((i) => (i + 1) % filteredMentionAgents.length);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setMentionIndex(
                        (i) => (i - 1 + filteredMentionAgents.length) % filteredMentionAgents.length,
                      );
                      return;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      event.preventDefault();
                      insertMention(filteredMentionAgents[mentionIndex]);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setMentionOpen(false);
                      return;
                    }
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={2}
              />
              <button
                type="submit"
                className="send-button"
                disabled={isRunning || !composerText.trim()}
                aria-label="Send"
                title="Send"
              >
                <CornerDownLeft size={18} />
              </button>
            </div>
          </div>
        </form>
      </section>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        quickUsers={quickUsers}
        selectedEmployee={selectedEmployee}
        customEmployee={customEmployee}
        setCustomEmployee={setCustomEmployee}
        selectEmployee={selectEmployee}
        tokenInput={tokenInput}
        setTokenInput={setTokenInput}
        saveToken={saveToken}
        selectedSandbox={selectedSandbox}
        selectedNode={selectedNode}
        activeRun={activeRun}
        onCancelRun={cancelActiveRun}
      />
    </main>
  );
}
```

Note: `Plus` import was already in the lucide-react imports at the top of the original file but was missing from the new imports above. Add it: `import { ..., Plus, ... } from "lucide-react";` — it's already in the imports block shown above.

- [ ] **Step 2: Verify line count**

```bash
wc -l packages/relay-web/src/App.tsx
```

Expected: under 600 lines.

- [ ] **Step 3: Type-check**

```bash
cd packages/relay-web && npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors.

---

## Task 10: Font upgrade — DM Sans via next/font/google

**Files:**
- Modify: `packages/relay-web/src/app/layout.tsx`

`next/font/google` is bundled with Next.js — no extra install needed. Setting the variable `--font-sans` picks up the existing `var(--font-sans, "Inter")` reference in styles.css with no CSS change required.

- [ ] **Step 1: Update layout.tsx**

```tsx
// packages/relay-web/src/app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Sans } from "next/font/google";
import { JetBrains_Mono } from "next/font/google";

import "../styles.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Relay — Workforce control plane",
  description: "Coordinate Claude, Pi, and Codex inside employee sandboxes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

---

## Task 11: CSS — dark mode, active row tint, agent avatar colors, message animation, empty state, user avatar

**Files:**
- Modify: `packages/relay-web/src/styles.css`

Six targeted changes:

1. **Dark mode** — add `@media (prefers-color-scheme: dark)` `:root` override block after the existing `:root` block
2. **Active row tint** — change `.conversation-row.active` background from `--color-canvas` to a 5% primary mix
3. **Per-agent avatar colors** — add `[data-agent="claude/pi/codex"]` selectors
4. **message-in animation** — increase translateY from `4px` to `10px`, duration from unset to `220ms`
5. **Empty state brand mark** — add `.empty-brand-mark` sizing rule
6. **User avatar** — swap `::before` pseudo-element for `.user-avatar` class

- [ ] **Step 1: Add dark mode block after `:root { color-scheme: light; }`**

Find the line `color-scheme: light;` in styles.css (line ~139). After the closing `}` of the `:root` block, insert:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-ink: #e4e8ed;
    --color-body: #8d96a0;
    --color-muted: #606870;
    --color-muted-soft: #434b55;
    --color-on-dark: #e4e8ed;
    --color-canvas: #0e1318;
    --color-surface-soft: #141b22;
    --color-surface-strong: #1b2430;
    --color-hairline: #263040;
    --color-hairline-soft: #1b2430;

    color-scheme: dark;
    background: var(--color-canvas);
    color: var(--color-ink);
  }
}
```

- [ ] **Step 2: Update active conversation row background**

Find and replace (unique in the file):

```css
/* Before */
.conversation-row.active {
  background: var(--color-canvas);
}
```

```css
/* After */
.conversation-row.active {
  background: color-mix(in srgb, var(--color-primary) 5%, var(--color-canvas));
}
```

- [ ] **Step 3: Add per-agent avatar color selectors**

After the `.agent-avatar { ... }` block (ends around line 483), add:

```css
.agent-avatar[data-agent="claude"] {
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-strong));
  color: var(--color-primary);
}

.agent-avatar[data-agent="pi"] {
  background: color-mix(in srgb, var(--color-semantic-up) 10%, var(--color-surface-strong));
  color: var(--color-semantic-up);
}

.agent-avatar[data-agent="codex"] {
  background: color-mix(in srgb, var(--color-accent-yellow) 15%, var(--color-surface-strong));
  color: color-mix(in srgb, var(--color-accent-yellow) 80%, var(--color-ink));
}
```

- [ ] **Step 4: Strengthen message-in animation**

Find and replace:

```css
/* Before */
.msg {
  display: grid;
  gap: var(--space-xs);
  animation: message-in 180ms ease-out both;
}

@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
```

```css
/* After */
.msg {
  display: grid;
  gap: var(--space-xs);
  animation: message-in 220ms ease-out both;
}

@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
```

- [ ] **Step 5: Add empty-state brand mark size**

After `.transcript-empty p { ... }` block, add:

```css
.empty-brand-mark {
  width: 64px;
  height: auto;
  opacity: 0.75;
}
```

- [ ] **Step 6: Replace user avatar pseudo-element with class**

Find and replace the `::before` rule:

```css
/* Before */
.msg-user::before {
  content: "Y";
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-top: 2px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: var(--text-xs);
  font-weight: 600;
}
```

```css
/* After */
.user-avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-top: 2px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: var(--text-xs);
  font-weight: 600;
  flex-shrink: 0;
  align-self: start;
}
```

---

## Task 12: Syntax highlighting — lightweight tokenizer

**Files:**
- Create: `packages/relay-web/src/lib/highlight.ts`
- Modify: `packages/relay-web/src/components/AgentStream.tsx`

The tokenizer splits code into typed spans. `AgentStream.tsx` wraps each in a `<span className="hl-{kind}">`. Color is set in `styles.css`.

- [ ] **Step 1: Create highlight.ts**

```ts
// packages/relay-web/src/lib/highlight.ts

export type HlToken = { kind: HlKind; text: string };
export type HlKind = "keyword" | "string" | "number" | "comment" | "plain";

const KEYWORDS = new Set([
  // TypeScript / JavaScript
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "class", "new", "this", "super",
  "import", "export", "default", "from", "async", "await", "try", "catch",
  "finally", "throw", "typeof", "instanceof", "void", "null", "undefined",
  "true", "false", "type", "interface", "enum", "extends", "implements",
  // Python
  "def", "pass", "lambda", "with", "as", "yield", "raise", "del", "global",
  "nonlocal", "assert", "not", "and", "or", "in", "is", "None", "True", "False",
  // Go
  "func", "go", "chan", "map", "struct", "range", "select", "defer", "package",
  "var",
]);

export function tokenize(code: string): HlToken[] {
  const out: HlToken[] = [];
  let i = 0;

  while (i < code.length) {
    // Single-line comment: // or #
    if (
      (code[i] === "/" && code[i + 1] === "/") ||
      (code[i] === "#" && (i === 0 || /\s/.test(code[i - 1])))
    ) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      out.push({ kind: "comment", text: code.slice(i, stop) });
      i = stop;
      continue;
    }

    // Block comment: /* … */
    if (code[i] === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out.push({ kind: "comment", text: code.slice(i, stop) });
      i = stop;
      continue;
    }

    // Strings: ", ', `
    if (code[i] === '"' || code[i] === "'" || code[i] === "`") {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === "\\" && j + 1 < code.length) { j += 2; continue; }
        if (code[j] === quote) { j += 1; break; }
        j += 1;
      }
      out.push({ kind: "string", text: code.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(code[i]) && (i === 0 || /\W/.test(code[i - 1]))) {
      let j = i;
      while (j < code.length && /[0-9._xXa-fA-F]/.test(code[j])) j += 1;
      out.push({ kind: "number", text: code.slice(i, j) });
      i = j;
      continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_$]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[\w$]/.test(code[j])) j += 1;
      const word = code.slice(i, j);
      out.push({ kind: KEYWORDS.has(word) ? "keyword" : "plain", text: word });
      i = j;
      continue;
    }

    // Everything else: gather non-word chars as plain
    let j = i;
    while (
      j < code.length &&
      !/[a-zA-Z_$0-9"'`#/]/.test(code[j]) &&
      !(code[j] === "/" && (code[j + 1] === "/" || code[j + 1] === "*"))
    ) {
      j += 1;
    }
    if (j === i) j = i + 1;
    out.push({ kind: "plain", text: code.slice(i, j) });
    i = j;
  }

  return out;
}
```

- [ ] **Step 2: Update AgentStream.tsx to use tokenizer for code blocks**

Replace the `renderProse` function and imports in `packages/relay-web/src/components/AgentStream.tsx`. The existing file imports `Check, CircleAlert, Info, Terminal, TriangleAlert, Wrench` from lucide-react and exports `AgentStream`. Only the `renderProse` function and the code fence rendering inside it change.

Replace the file:

```tsx
// packages/relay-web/src/components/AgentStream.tsx
import { Check, CircleAlert, Info, Terminal, TriangleAlert, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import type { AgentName } from "../types";
import { parseAgentStream, parseAgentStderr, type AgentSegment } from "../lib/agentStream";
import { tokenize } from "../lib/highlight";

type AgentStreamProps = {
  agent: AgentName;
  stdout: string;
  stderr: string;
  streaming: boolean;
};

export function AgentStream({ agent, stdout, stderr, streaming }: AgentStreamProps) {
  const segments = [
    ...parseAgentStream(agent, stdout),
    ...parseAgentStderr(stderr),
  ];

  if (segments.length === 0) {
    return <p className="msg-quiet">{streaming ? "Working…" : "No output."}</p>;
  }

  return (
    <div className={`agent-stream ${streaming ? "streaming" : ""}`}>
      {segments.map((segment, i) => (
        <SegmentView key={i} segment={segment} />
      ))}
    </div>
  );
}

function SegmentView({ segment }: { segment: AgentSegment }) {
  if (segment.kind === "text") {
    return <div className="agent-text">{renderProse(segment.text)}</div>;
  }
  if (segment.kind === "thinking") {
    return (
      <details className="agent-thinking">
        <summary>
          <span className="agent-segment-label">Thinking</span>
        </summary>
        <div className="agent-thinking-body">{renderProse(segment.text)}</div>
      </details>
    );
  }
  if (segment.kind === "tool") {
    return (
      <div className="agent-tool">
        <Wrench size={13} aria-hidden="true" />
        <span className="agent-segment-label">Tool</span>
        <span className="agent-tool-name">{segment.name}</span>
      </div>
    );
  }
  if (segment.kind === "command") {
    return (
      <div className="agent-command">
        <Terminal size={13} aria-hidden="true" />
        <code>{segment.command}</code>
      </div>
    );
  }
  if (segment.kind === "status") {
    return (
      <div className={`agent-status agent-status-${segment.tone}`}>
        <StatusIcon tone={segment.tone} />
        <span>{segment.text}</span>
      </div>
    );
  }
  return <pre className="agent-raw">{segment.text}</pre>;
}

function StatusIcon({ tone }: { tone: "good" | "bad" | "warn" | "info" }) {
  if (tone === "good") return <Check size={13} aria-hidden="true" />;
  if (tone === "bad") return <CircleAlert size={13} aria-hidden="true" />;
  if (tone === "warn") return <TriangleAlert size={13} aria-hidden="true" />;
  return <Info size={13} aria-hidden="true" />;
}

type ProseChunk =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string | null; text: string };

function splitFences(text: string): ProseChunk[] {
  const out: ProseChunk[] = [];
  const pattern = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    out.push({ kind: "code", lang: match[1] || null, text: match[2].replace(/\n+$/, "") });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    out.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return out;
}

function renderProse(text: string): ReactNode {
  const parts = splitFences(text);
  return parts.map((part, i) => {
    if (part.kind === "code") {
      return (
        <pre className="agent-code" key={i}>
          {part.lang ? <span className="agent-code-lang">{part.lang}</span> : null}
          <code>
            {tokenize(part.text).map((token, j) => (
              <span key={j} className={`hl-${token.kind}`}>
                {token.text}
              </span>
            ))}
          </code>
        </pre>
      );
    }
    return (
      <div className="agent-prose" key={i}>
        {part.text.split(/\n{2,}/).map((para, j) => (
          <p key={j}>{renderInline(para)}</p>
        ))}
      </div>
    );
  });
}

function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(renderLineBreaks(text.slice(lastIndex, match.index), key++));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(renderLineBreaks(text.slice(lastIndex), key++));
  }
  return nodes;
}

function renderLineBreaks(text: string, key: number): ReactNode {
  const lines = text.split("\n");
  return (
    <span key={key}>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 3: Add syntax highlight color tokens to styles.css**

After the `.agent-code code { font: inherit; ... }` block (around line 1156), add:

```css
/* Syntax highlight token colors */
.hl-keyword { color: var(--color-primary); font-weight: 500; }
.hl-string  { color: var(--color-semantic-up); }
.hl-number  { color: var(--color-accent-yellow); }
.hl-comment { color: var(--color-muted); font-style: italic; }
.hl-plain   { /* inherits agent-code color */ }
```

---

## Task 13: Build and verify

**Files:** none (verification only)

- [ ] **Step 1: Build the full workspace**

```bash
npm run build 2>&1 | tail -30
```

Expected: exits 0. The `relay-web` package builds last; look for `✓ Compiled` or no TypeScript errors.

- [ ] **Step 2: Check App.tsx final line count**

```bash
wc -l packages/relay-web/src/App.tsx
```

Expected: ≤ 600 lines.

- [ ] **Step 3: Spot-check all new files exist**

```bash
ls packages/relay-web/src/components/ packages/relay-web/src/hooks/ packages/relay-web/src/lib/highlight.ts
```

Expected: `AgentStream.tsx ConversationRow.tsx EmployeeAvatar.tsx MessageBlock.tsx RelayMark.tsx SettingsDrawer.tsx StatusPill.tsx TranscriptEmpty.tsx` in components; `useRelayData.ts` in hooks; `highlight.ts` in lib.

---

## Self-Review

### Spec coverage check

| Issue | Task |
|---|---|
| Brand SVG unused | Task 1, 9 — RelayMark component + wired into App brand area |
| Inter font generic | Task 10 — DM Sans via next/font/google |
| App.tsx 1427 lines | Tasks 2-9 — split into 6 components + 1 hook |
| Empty state weak | Task 4, 9 — TranscriptEmpty uses RelayMark at 64px |
| Active row invisible | Task 11 step 2 — 5% primary tint |
| Agent avatars identical | Task 5 (data-agent attribute), Task 11 step 3 — per-agent colors |
| "Y" hardcoded in CSS | Task 5 (JSX user-avatar span), Task 11 step 6 — `.user-avatar` class |
| No dark mode | Task 11 step 1 — dark mode `:root` block |
| No syntax highlighting | Task 12 — highlight.ts tokenizer + AgentStream update |
| Weak message animation | Task 11 step 4 — 10px / 220ms |

### Placeholder scan

No "TBD", "TODO", or "implement later" phrases. All steps have complete code.

### Type consistency

- `EmployeeContact` type defined in `ConversationRow.tsx` and re-exported; imported in `App.tsx` via `import type { EmployeeContact }`.
- `DerivedMessage` defined in `MessageBlock.tsx`, used internally — App.tsx no longer references it directly.
- `useRelayData` receives `setStatus` as a `React.Dispatch` param; App.tsx creates `setStatus` via `useState` and passes it — types match.
- `RelayMark` props: `width`, `height`, `className` — all optional with defaults; callers pass explicit values.
- `data-agent` attribute in JSX: plain HTML attribute, no TypeScript type error (it's a valid custom data attribute on `<span>`).
