"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Check, Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import {
  bootstrapUser,
  createControlPanelDaemonNode,
  getAuthStatus,
  getMe,
  listControlPanelDaemonNodes,
  login,
} from "../api";
import type { ControlPanelDaemonNodeRecord, CurrentUser, Tone } from "../types";
import type { DaemonNodeActiveRun } from "relay-core";

// ── Constants ────────────────────────────────────────────────────────────────

const STALE_AFTER_MS = 15_000;
const QUIET_AFTER_MS = 10_000;
const adminNodeTokenStorageKey = "relay-web.adminNodeTokens";

interface StoredNodeToken {
  employeeId: string;
  nodeToken: string;
  daemonCommand?: string;
  savedAt: string;
}

type StoredNodeTokenMap = Record<string, StoredNodeToken>;

// ── Pure helpers ─────────────────────────────────────────────────────────────

function isStale(node: ControlPanelDaemonNodeRecord): boolean {
  if (typeof node.stale === "boolean") return node.stale;
  if (!node.online) return true;
  if (!node.lastSeenAt) return true;
  return Date.now() - new Date(node.lastSeenAt).getTime() > STALE_AFTER_MS;
}

function visualStatus(node: ControlPanelDaemonNodeRecord): string {
  return isStale(node) ? "stale" : node.status;
}

function statusTone(status: string): Tone {
  if (status === "ready") return "good";
  if (status === "running" || status === "provisioning") return "info";
  if (status === "failed" || status === "stale") return "bad";
  if (status === "stopped") return "warn";
  return "neutral";
}

function agentStatusTone(agentStatus: string): "good" | "bad" | "neutral" {
  if (agentStatus === "ready") return "good";
  if (agentStatus === "failed") return "bad";
  return "neutral";
}

function formatRelativeTime(value: string | undefined, t: TFunction): string {
  if (!value) return t("admin.time.never");
  const deltaMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(deltaMs)) return t("admin.time.unknown");
  if (deltaMs < 1_000) return t("admin.time.now");

  const seconds = Math.floor(deltaMs / 1_000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const locale = typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  if (minutes < 60) return rtf.format(-minutes, "minute");
  return rtf.format(-hours, "hour");
}

interface AttentionItem {
  nodeId: string;
  employeeId: string;
  kind: "error" | "stale-run" | "quiet";
  body: string;
}

function buildAttentionItems(nodes: ControlPanelDaemonNodeRecord[], t: TFunction): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const node of nodes) {
    if (node.lastError) {
      items.push({ nodeId: node.id, employeeId: node.employeeId, kind: "error", body: node.lastError });
    }
    if (isStale(node) && node.activeRuns.length > 0) {
      const count = node.activeRuns.length;
      items.push({
        nodeId: node.id,
        employeeId: node.employeeId,
        kind: "stale-run",
        body: t("admin.stale_run_body", { count }),
      });
    }
    const ageMs = node.lastSeenAgeMs ?? (node.lastSeenAt
      ? Date.now() - new Date(node.lastSeenAt).getTime()
      : Infinity);
    if (!node.lastError && !isStale(node) && ageMs > QUIET_AFTER_MS) {
      items.push({
        nodeId: node.id,
        employeeId: node.employeeId,
        kind: "quiet",
        body: t("admin.quiet_body", { time: formatRelativeTime(node.lastSeenAt, t) }),
      });
    }
  }
  return items.slice(0, 6);
}

function readStoredNodeTokens(): StoredNodeTokenMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(adminNodeTokenStorageKey) ?? "null") as StoredNodeTokenMap | null;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeStoredNodeTokens(tokens: StoredNodeTokenMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(adminNodeTokenStorageKey, JSON.stringify(tokens));
  } catch {
    // Token reveal remains available for the current React state even if browser storage is blocked.
  }
}

async function copyText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <div className="ac-metric">
      <span className={`ac-metric-value ${tone}`}>{value}</span>
      <span className="ac-metric-label">{label}</span>
    </div>
  );
}

function AgentChips({ agents }: { agents: ControlPanelDaemonNodeRecord["agents"] }) {
  return (
    <div className="ac-agents">
      {(Object.keys(agents) as Array<keyof typeof agents>).map((name) => {
        const status = agents[name] ?? "unknown";
        const tone = agentStatusTone(status);
        return (
          <span key={name} className={`ac-agent-chip ${tone}`}>
            {name}
          </span>
        );
      })}
    </div>
  );
}

function CopyValueRow({
  label,
  value,
  copyLabel,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copyLabel: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ac-copy-row">
      <div className="ac-token-head">
        <span className="ac-token-label">{label}</span>
      </div>
      <div className="ac-copy-value-line">
        <div className="ac-token-display mono">{value}</div>
        <button
          type="button"
          className={`ac-copy-button ${copied ? "copied" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
          aria-label={copyLabel}
          title={copyLabel}
        >
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          <span>{copied ? t("admin.copied") : t("admin.copy")}</span>
        </button>
      </div>
    </div>
  );
}

function RosterRow({
  node,
  storedToken,
  expandedTokenNodeId,
  onToggleToken,
}: {
  node: ControlPanelDaemonNodeRecord;
  storedToken?: StoredNodeToken;
  expandedTokenNodeId: string | null;
  onToggleToken: (nodeId: string) => void;
}) {
  const status = visualStatus(node);
  const tone = statusTone(status);
  const isExpanded = node.id === expandedTokenNodeId;
  const isRunning = !isStale(node) && node.status === "running";
  const revealableToken = storedToken?.nodeToken ?? node.nodeToken;
  const daemonCommand = storedToken?.daemonCommand;
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { t } = useTranslation();

  async function handleCopy(field: string, value: string) {
    await copyText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1400);
  }

  return (
    <>
      <tr
        className={`${isRunning ? "ac-row-running" : ""} ${isExpanded ? "ac-row-selected" : ""}`}
        onClick={() => onToggleToken(node.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleToken(node.id);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={t("admin.toggle_token", { employee: node.employeeId })}
      >
        <td>
          <span className="ac-node-name" translate="no">@{node.employeeId}</span>
          <span className="ac-node-id mono">
            <span className="ac-node-id-label">{t("admin.sandbox_id")}</span>
            {node.id}
            <button
              type="button"
              className="ac-inline-copy"
              onClick={(event) => {
                event.stopPropagation();
                void handleCopy("sandbox-inline", node.id);
              }}
              aria-label={t("admin.copy_sandbox_id")}
              title={t("admin.copy_sandbox_id")}
            >
              {copiedField === "sandbox-inline" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            </button>
          </span>
        </td>
        <td>
          <span className={`ac-status-pill ${tone}`}>{t(`status.${status}`, { defaultValue: status })}</span>
        </td>
        <td>
          <AgentChips agents={node.agents} />
        </td>
        <td>
          <span className="ac-meta-time mono">{formatRelativeTime(node.lastSeenAt, t)}</span>
          {node.queuedCommandCount > 0 && (
            <span className="ac-meta-sub mono">{node.queuedCommandCount} {t("admin.queued")}</span>
          )}
        </td>
        <td>
          <button
            type="button"
            className={`ac-reveal-button ${revealableToken ? "available" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleToken(node.id);
            }}
            aria-label={t("admin.toggle_token", { employee: node.employeeId })}
            title={t("admin.toggle_token", { employee: node.employeeId })}
          >
            {isExpanded ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            <span>{isExpanded ? t("admin.hide_token") : t("admin.reveal_token")}</span>
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="ac-token-row">
          <td colSpan={5}>
            <div className="ac-token-row-inner">
              <div className="ac-token-head">
                <span className="ac-token-label">
                  <KeyRound size={14} aria-hidden="true" />
                  {t("admin.credentials")}
                </span>
              </div>
              <CopyValueRow
                label={t("admin.sandbox_id")}
                value={node.id}
                copyLabel={t("admin.copy_sandbox_id")}
                copied={copiedField === "sandbox"}
                onCopy={() => void handleCopy("sandbox", node.id)}
              />
              {revealableToken ? (
                <>
                  <CopyValueRow
                    label={t("admin.daemon_token")}
                    value={revealableToken}
                    copyLabel={t("admin.copy_daemon_token")}
                    copied={copiedField === "token"}
                    onCopy={() => void handleCopy("token", revealableToken)}
                  />
                  <p className="ac-token-note">{t("admin.token_cached_note", { employee: node.employeeId })}</p>
                </>
              ) : (
                <div className="ac-token-display empty mono">
                  {t("admin.token_unavailable")}
                </div>
              )}
              {daemonCommand && (
                <CopyValueRow
                  label={t("admin.daemon_command")}
                  value={daemonCommand}
                  copyLabel={t("admin.copy_daemon_command")}
                  copied={copiedField === "command"}
                  onCopy={() => void handleCopy("command", daemonCommand)}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ActiveRunCard({ run, employeeId }: { run: DaemonNodeActiveRun; employeeId: string }) {
  const { t } = useTranslation();
  return (
    <div className="ac-card">
      <p className="ac-card-meta mono">{run.agent} · {run.mode} · <span translate="no">@{employeeId}</span></p>
      <p className="ac-card-title">{run.taskGoal}</p>
      <p className="ac-card-body mono" style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-xxs)" }}>
        {t("admin.started", { time: formatRelativeTime(run.startedAt, t) })}
      </p>
    </div>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const { t } = useTranslation();
  const kindLabel = item.kind === "error" ? t("admin.kind_error") : item.kind === "stale-run" ? t("admin.kind_stale_run") : t("admin.kind_quiet");
  const kindTone = item.kind === "error" ? "bad" : item.kind === "stale-run" ? "warn" : "neutral";
  return (
    <div className="ac-card">
      <p className="ac-card-meta mono">
        <span className={`ac-status-pill ${kindTone}`} style={{ marginRight: "var(--space-xs)" }}>{kindLabel}</span>
        <span translate="no">@{item.employeeId}</span>
      </p>
      <p className="ac-card-body">{item.body}</p>
    </div>
  );
}

function LoginForm({ onLogin, needsBootstrap }: { onLogin: () => void; needsBootstrap: boolean }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login({ username: username.trim(), password });
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="ac-block ac-admin-form-block">
      <div className="ac-block-head">
        <h2>{t("admin.login")}</h2>
      </div>
      <p className="ac-form-hint">{needsBootstrap ? t("admin.no_admins") : t("admin.login_sub")}</p>
      <form className="ac-create-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="ac-field">
          <span>{t("admin.username")}</span>
          <input
            className="ac-input mono"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="ac-field">
          <span>{t("admin.password")}</span>
          <input
            className="ac-input mono"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className="ac-create-button" type="submit" disabled={isLoading || !username.trim() || !password}>
          {isLoading ? t("admin.creating") : t("admin.sign_in")}
        </button>
      </form>
      {error && <div className="ac-error ac-form-error">{error}</div>}
    </section>
  );
}

function BootstrapForm({ onBootstrapped }: { onBootstrapped: () => void }) {
  const { t } = useTranslation();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await bootstrapUser({ token: token.trim(), username: username.trim(), password });
      onBootstrapped();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="ac-block ac-admin-form-block">
      <div className="ac-block-head">
        <h2>{t("admin.bootstrap")}</h2>
      </div>
      <p className="ac-form-hint">{t("admin.bootstrap_sub")}</p>
      <form className="ac-create-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="ac-field">
          <span>{t("admin.bootstrap_token")}</span>
          <input
            className="ac-input mono"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="ac-field">
          <span>{t("admin.username")}</span>
          <input
            className="ac-input mono"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="ac-field">
          <span>{t("admin.password")}</span>
          <input
            className="ac-input mono"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <button className="ac-create-button" type="submit" disabled={isLoading || !token.trim() || !username.trim() || !password}>
          {isLoading ? t("admin.creating") : t("admin.create_admin")}
        </button>
      </form>
      {error && <div className="ac-error ac-form-error">{error}</div>}
    </section>
  );
}

// ── AdminConsole ──────────────────────────────────────────────────────────────

export function AdminConsole() {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<ControlPanelDaemonNodeRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [expandedTokenNodeId, setExpandedTokenNodeId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [storedNodeTokens, setStoredNodeTokens] = useState<StoredNodeTokenMap>(() => readStoredNodeTokens());

  const [admin, setAdmin] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  async function checkAuth(signal?: AbortSignal) {
    try {
      const statusResult = await getAuthStatus(signal);
      setNeedsBootstrap(statusResult.requiresBootstrap);
    } catch {
      setNeedsBootstrap(false);
    }
    try {
      const result = await getMe(signal);
      if (result.authenticated && result.user?.role === "admin") {
        setAdmin(result.user);
      } else {
        setAdmin(null);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const status = err && typeof err === "object" && "status" in err ? (err as { status: number }).status : 0;
      setAdmin(null);
      if (status === 503) {
        setFetchError(t("admin.admin_token_required"));
      }
    } finally {
      setAuthChecked(true);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void checkAuth(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();

    async function poll() {
      setIsFetching(true);
      try {
        const result = await listControlPanelDaemonNodes(controller.signal);
        setNodes(result.nodes);
        setLastUpdated(new Date());
        setFetchError(null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        setFetchError(message);
        if (message.includes("401") || message.includes("Session expired") || message.includes("Admin token is required")) {
          setAdmin(null);
        }
      } finally {
        setIsFetching(false);
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [admin, t]);

  function toggleToken(nodeId: string) {
    setExpandedTokenNodeId((prev) => (prev === nodeId ? null : nodeId));
  }

  async function createNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmployeeId = employeeId.trim().replace(/^@/, "");
    if (!nextEmployeeId) {
      setCreateError(t("admin.employee_required"));
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      const result = await createControlPanelDaemonNode({
        employeeId: nextEmployeeId,
        workspacePath: workspacePath.trim() || undefined,
      });
      setNodes((current) => [result.node, ...current.filter((node) => node.id !== result.node.id)]);
      if (result.nodeToken) {
        setStoredNodeTokens((current) => {
          const next = {
            ...current,
            [result.node.id]: {
              employeeId: result.node.employeeId,
              nodeToken: result.nodeToken ?? "",
              daemonCommand: result.daemonCommand,
              savedAt: new Date().toISOString(),
            },
          };
          writeStoredNodeTokens(next);
          return next;
        });
      }
      setExpandedTokenNodeId(result.node.id);
      setEmployeeId("");
      setWorkspacePath("");
      setLastUpdated(new Date());
      setFetchError(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }

  if (!authChecked) {
    return (
      <section className="admin-console">
        <div className="ac-empty">{t("admin.loading")}</div>
      </section>
    );
  }

  if (!admin) {
    return (
      <section className="admin-console">
        <header className="ac-header">
          <div className="ac-header-title">
            <h1>{t("admin.title")}</h1>
            <span className="ac-header-sub mono">{t("admin.sub")}</span>
          </div>
        </header>
        <div className="ac-body">
          <div className="ac-main-col">
            {needsBootstrap ? (
              <BootstrapForm onBootstrapped={() => void checkAuth()} />
            ) : (
              <LoginForm onLogin={() => void checkAuth()} needsBootstrap={false} />
            )}
          </div>
        </div>
      </section>
    );
  }

  // Derived metrics
  const total = nodes.length;
  const ready = nodes.filter((n) => visualStatus(n) === "ready").length;
  const running = nodes.filter((n) => !isStale(n) && n.status === "running").length;
  const failed = nodes.filter((n) => {
    const s = visualStatus(n);
    return s === "failed" || s === "stale";
  }).length;
  const queued = nodes.reduce((acc, n) => acc + n.queuedCommandCount, 0);

  const allActiveRuns: Array<{ run: DaemonNodeActiveRun; employeeId: string }> = nodes.flatMap((n) =>
    isStale(n) ? [] : n.activeRuns.map((run) => ({ run, employeeId: n.employeeId })),
  );

  const attentionItems = buildAttentionItems(nodes, t);

  const lastUpdatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <section className="admin-console">
      <header className="ac-header">
        <div className="ac-header-title">
          <h1>{t("admin.title")}</h1>
          <span className="ac-header-sub mono">{t("admin.sub")}</span>
        </div>
        <div className="ac-header-status">
          <span className={`ac-live-dot ${fetchError ? "offline" : isFetching ? "fetching" : ""}`} aria-hidden="true" />
          {fetchError ? (
            <span className="ac-error">{fetchError}</span>
          ) : lastUpdatedStr ? (
            <span className="ac-timestamp mono">{t("admin.updated_at", { time: lastUpdatedStr })}</span>
          ) : null}
          <span className="ac-admin-user mono" translate="no">@{admin.username}</span>
        </div>
      </header>

      <div className="ac-metrics-band">
        <MetricCard label={t("admin.metric_nodes")} value={total} tone="neutral" />
        <MetricCard label={t("admin.metric_ready")} value={ready} tone="good" />
        <MetricCard label={t("admin.metric_running")} value={running} tone="info" />
        <MetricCard label={t("admin.metric_failed")} value={failed} tone="bad" />
        <MetricCard label={t("admin.metric_queued")} value={queued} tone="neutral" />
      </div>

      <div className="ac-body">
        <div className="ac-main-col">
          <section className="ac-block ac-admin-form-block">
            <div className="ac-block-head">
              <h2>{t("admin.create_employee")}</h2>
            </div>
            <form className="ac-create-form" onSubmit={(event) => void createNode(event)}>
              <label className="ac-field">
                <span>{t("admin.employee_id")}</span>
                <input
                  className="ac-input mono"
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                  autoComplete="off"
                  placeholder="alice"
                />
              </label>
              <label className="ac-field">
                <span>{t("admin.workspace_path")}</span>
                <input
                  className="ac-input mono"
                  value={workspacePath}
                  onChange={(event) => setWorkspacePath(event.target.value)}
                  autoComplete="off"
                  placeholder="/workspace/alice"
                />
              </label>
              <button className="ac-create-button" type="submit" disabled={isCreating}>
                {isCreating ? t("admin.creating") : t("admin.create")}
              </button>
            </form>
            {createError && <div className="ac-error ac-form-error">{createError}</div>}
          </section>

          <section className="ac-block">
            <div className="ac-block-head">
              <h2>{t("admin.the_roster")}</h2>
              <span className="ac-count mono">{t("admin.node_count", { count: total })}</span>
            </div>
            {nodes.length === 0 ? (
              <div className="ac-empty">{t("admin.no_nodes")}</div>
            ) : (
              <table className="ac-table">
                <thead>
                  <tr>
                    <th>{t("admin.col_employee")}</th>
                    <th>{t("admin.col_status")}</th>
                    <th>{t("admin.col_agents")}</th>
                    <th>{t("admin.col_last_seen")}</th>
                    <th>{t("admin.col_token")}</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => (
                    <RosterRow
                      key={node.id}
                      node={node}
                      storedToken={storedNodeTokens[node.id]}
                      expandedTokenNodeId={expandedTokenNodeId}
                      onToggleToken={toggleToken}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="ac-side-col">
          <section className="ac-block">
            <div className="ac-block-head">
              <h2>{t("admin.in_progress")}</h2>
              <span className="ac-count mono">{t("admin.running_count", { count: allActiveRuns.length })}</span>
            </div>
            {allActiveRuns.length === 0 ? (
              <div className="ac-empty">{t("admin.no_active_runs")}</div>
            ) : (
              <div className="ac-card-list">
                {allActiveRuns.map(({ run, employeeId }) => (
                  <ActiveRunCard key={run.commandId} run={run} employeeId={employeeId} />
                ))}
              </div>
            )}
          </section>

          <section className="ac-block">
            <div className="ac-block-head">
              <h2>{t("admin.wants_attention")}</h2>
              <span className="ac-count mono">{t("admin.item_count", { count: attentionItems.length })}</span>
            </div>
            {attentionItems.length === 0 ? (
              <div className="ac-empty">{t("admin.all_clear")}</div>
            ) : (
              <div className="ac-card-list">
                {attentionItems.map((item, i) => (
                  <AttentionCard key={`${item.nodeId}-${item.kind}-${i}`} item={item} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
