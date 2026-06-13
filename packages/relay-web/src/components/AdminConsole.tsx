"use client";

import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { listControlPanelDaemonNodes } from "../api";
import type { ControlPanelDaemonNodeRecord, Tone } from "../types";
import type { DaemonNodeActiveRun } from "relay-backend";

// ── Constants ────────────────────────────────────────────────────────────────

const STALE_AFTER_MS = 15_000;
const QUIET_AFTER_MS = 10_000;

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
  if (deltaMs < 60_000) return t("admin.time.seconds_ago", { n: Math.floor(deltaMs / 1_000) });
  if (deltaMs < 3_600_000) return t("admin.time.minutes_ago", { n: Math.floor(deltaMs / 60_000) });
  return t("admin.time.hours_ago", { n: Math.floor(deltaMs / 3_600_000) });
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

function RosterRow({
  node,
  expandedTokenNodeId,
  onToggleToken,
}: {
  node: ControlPanelDaemonNodeRecord;
  expandedTokenNodeId: string | null;
  onToggleToken: (nodeId: string) => void;
}) {
  const status = visualStatus(node);
  const tone = statusTone(status);
  const isExpanded = node.id === expandedTokenNodeId;
  const isRunning = !isStale(node) && node.status === "running";
  const { t } = useTranslation();

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
          <span className="ac-node-id mono">{node.id}</span>
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
      </tr>
      {isExpanded && (
        <tr className="ac-token-row">
          <td colSpan={4}>
            <div className="ac-token-row-inner">
              <div className="ac-token-head">
                <span className="ac-token-label">{t("admin.daemon_token")}</span>
                <span className="ac-token-label mono" style={{ fontWeight: 400 }}>
                  {node.id}
                </span>
              </div>
              {node.nodeToken ? (
                <div className="ac-token-display mono">{node.nodeToken}</div>
              ) : (
                <div className="ac-token-display empty mono">
                  {t("admin.token_unavailable")}
                </div>
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

// ── AdminConsole ──────────────────────────────────────────────────────────────

export function AdminConsole() {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<ControlPanelDaemonNodeRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [expandedTokenNodeId, setExpandedTokenNodeId] = useState<string | null>(null);

  useEffect(() => {
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
        setFetchError(err instanceof Error ? err.message : String(err));
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
  }, []);

  function toggleToken(nodeId: string) {
    setExpandedTokenNodeId((prev) => (prev === nodeId ? null : nodeId));
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
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => (
                    <RosterRow
                      key={node.id}
                      node={node}
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
