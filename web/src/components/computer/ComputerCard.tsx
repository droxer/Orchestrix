"use client";

import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { AgentName, ControlPanelDaemonNodeRecord } from "../../types";
import { AgentMark } from "../AgentMark";
import { StateMark } from "../StateMark";
import { NodePresence } from "../admin/NodePresence";
import { nodeOwnershipIcon } from "../admin/NodeProfileBadges";
import { Button } from "../ui/button";
import { ActionApprove, ActionCopy, ActionEdit, ActionRemove, AdminManageExecutors } from "../icons";
import { abbreviateNodeId, formatRunElapsed } from "../../lib/computerNodes";
import { labelForExecutor } from "../../lib/agentDisplayNames";
import {
  COPY_FEEDBACK_MS,
  agentStatusTone,
  copyText,
  formatRelativeTime,
  isNodeOnline,
  nodeAgentPresence,
  nodeOwnershipProfile,
  nodeSandboxProfile,
  statusTone,
  visibleNodeAgentNames,
  visualStatus,
} from "../admin/helpers";

/**
 * One of the signed-in employee's own computers.
 *
 * Not `NodeCard`: that is a fleet-survey tile built to be scanned 40-at-a-time
 * by an admin, so it compresses a machine to a name, a truncated id, and four
 * unlabelled vendor glyphs. Here there are one or two machines and the reader
 * owns them, so the questions are different — "is anything running on it right
 * now", "which runtimes work", "where does my work land" — and the layout is a
 * record, not a tile.
 */
export function ComputerCard({
  node,
  onRename,
  onManageExecutors,
  onDisconnect,
  onOpenThread,
  t,
}: {
  node: ControlPanelDaemonNodeRecord;
  onRename: (node: ControlPanelDaemonNodeRecord) => void;
  onManageExecutors: (node: ControlPanelDaemonNodeRecord) => void;
  onDisconnect: (node: ControlPanelDaemonNodeRecord) => void;
  onOpenThread?: (sessionId: string) => void;
  t: TFunction;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  async function handleCopyId() {
    await copyText(node.id);
    setCopied(true);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }

  const named = Boolean(node.displayName?.trim()) && node.displayName !== node.id;
  const title = named ? node.displayName! : t("computer.unnamed");
  const status = visualStatus(node);
  const ownership = nodeOwnershipProfile(node);
  const sandbox = nodeSandboxProfile(node);
  const OwnershipMark = nodeOwnershipIcon(ownership);
  const runtimes = visibleNodeAgentNames(node);
  const activeRuns = node.activeRuns ?? [];
  // The status pill only earns its place when it says something the presence
  // readout below the name cannot: provisioning, failed, stopped.
  const showStatus = status !== "ready" && status !== "stale" && status !== "running";

  return (
    // Stale-aware, matching the presence pill: a daemon that stopped
    // heartbeating is dark even though its record still says `online`.
    <article className="computer-card" data-online={isNodeOnline(node) ? "true" : "false"}>
      <header className="computer-card-hero">
        <span className="computer-card-avatar" data-ownership={ownership} translate="no">
          <OwnershipMark size={20} aria-hidden="true" />
        </span>
        <div className="computer-card-identity">
          <div className="computer-card-nameline">
            <h2 className="computer-card-name" translate="no">{title}</h2>
            <NodePresence node={node} t={t} withLabel />
            {showStatus ? (
              <span className={`adm-status-pill tone-${statusTone(status)}`}>
                <i className="adm-status-dot" aria-hidden="true" />
                {t(`status.${status}`, { defaultValue: status })}
              </span>
            ) : null}
          </div>
          <p className="computer-card-sub">
            <span>{t(`admin.v2.node_ownership_${ownership}`)}</span>
            <span className="computer-card-sep" aria-hidden="true">·</span>
            <span>{t(`admin.v2.node_sandbox_${sandbox}`)}</span>
            <span className="computer-card-sep" aria-hidden="true">·</span>
            <span>{t("computer.last_seen", { time: formatRelativeTime(node.lastSeenAt, t) })}</span>
          </p>
        </div>
        {/* Labelled, not three bare icons: on the machine you own, "which one
            of these renames it" should not need a hover. */}
        <div className="computer-card-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => onRename(node)}>
            <ActionEdit size={14} aria-hidden="true" />
            {t("thread.rename")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onManageExecutors(node)}>
            <AdminManageExecutors size={14} aria-hidden="true" />
            {t("admin.v2.manage_executors")}
          </Button>
          {/* Removal is the counterpart to self-service enrollment, but it is
              not the action the reader came for — ghost keeps it reachable
              without competing with rename. */}
          <Button type="button" variant="ghost" size="sm" onClick={() => onDisconnect(node)}>
            <ActionRemove size={14} aria-hidden="true" />
            {t("computer.disconnect")}
          </Button>
        </div>
      </header>

      <section className="computer-card-activity" aria-label={t("computer.now_running")}>
        <h3 className="computer-card-section-title">
          {t("computer.now_running")}
          {activeRuns.length > 0 ? (
            <span className="computer-card-count tnum">{activeRuns.length}</span>
          ) : null}
        </h3>
        {activeRuns.length === 0 ? (
          // No --live ink when nothing is working: the accent means "an agent
          // is running right now" and must be absent at rest.
          <p className="computer-card-idle">{t("computer.idle")}</p>
        ) : (
          <ul className="computer-run-list">
            {activeRuns.map((run) => {
              const label = labelForExecutor(run.agent);
              const row = (
                <>
                  <StateMark shape="live" className="computer-run-mark" />
                  <AgentMark agent={run.agent} size={14} className="computer-run-agent-mark" />
                  <span className="computer-run-agent">{label}</span>
                  <span className="computer-run-goal">{run.taskGoal || t("computer.untitled_run")}</span>
                  <span className="computer-run-elapsed tnum">{formatRunElapsed(run.startedAt)}</span>
                </>
              );
              return (
                <li key={run.runId} className="computer-run-row">
                  {onOpenThread ? (
                    <button
                      type="button"
                      className="computer-run-open"
                      onClick={() => onOpenThread(run.sessionId)}
                      title={t("computer.open_run_thread")}
                    >
                      {row}
                    </button>
                  ) : (
                    <span className="computer-run-open" aria-disabled="true">{row}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="computer-card-body">
        <section className="computer-card-panel" aria-label={t("admin.v2.node_runtimes")}>
          <h3 className="computer-card-section-title">{t("admin.v2.node_runtimes")}</h3>
          {runtimes.length === 0 ? (
            <p className="computer-card-idle">{t("admin.v2.node_hosted_agents_empty")}</p>
          ) : (
            <ul className="computer-runtime-list">
              {runtimes.map((name) => (
                <RuntimeRow key={name} node={node} agent={name} t={t} />
              ))}
            </ul>
          )}
        </section>

        <section className="computer-card-panel" aria-label={t("computer.details")}>
          <h3 className="computer-card-section-title">{t("computer.details")}</h3>
          <dl className="computer-fact-list">
            <Fact label={t("computer.fact_workspace")}>
              <span className="code computer-fact-path" title={node.workspacePath}>
                {node.workspacePath || t("computer.fact_unset")}
              </span>
            </Fact>
            <Fact label={t("admin.queued")}>
              <span className="tnum">{node.queuedCommandCount}</span>
            </Fact>
            <Fact label={t("computer.fact_id")}>
              <span className="computer-fact-id">
                <span className="code" title={node.id} translate="no">{abbreviateNodeId(node.id)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  className="icon-button icon-button--sm icon-button--tinted"
                  onClick={() => void handleCopyId()}
                  aria-label={copied ? t("admin.copied") : t("admin.copy_node_id")}
                >
                  {copied ? <ActionApprove size={13} aria-hidden="true" /> : <ActionCopy size={13} aria-hidden="true" />}
                </Button>
              </span>
            </Fact>
          </dl>
        </section>
      </div>
    </article>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="computer-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RuntimeRow({
  node,
  agent,
  t,
}: {
  node: ControlPanelDaemonNodeRecord;
  agent: AgentName;
  t: TFunction;
}) {
  const nodeOnline = isNodeOnline(node);
  const disabled = Boolean(node.disabledAgents?.includes(agent));
  const agentStatus = node.agents[agent] ?? "unknown";
  const version = node.agentDetails?.[agent]?.version;
  const tone = agentStatusTone(agentStatus, { disabled });
  const presence = nodeAgentPresence(node, agent);
  // "Unknown" is accurate and unhelpful on a runtime the reader is trying to
  // use; say what it means instead. And on a computer that has gone dark, the
  // daemon's last "ready" is a memory, not an offer — the row says Offline
  // rather than repeating a readiness the machine can no longer honour.
  const stateLabel = disabled
    ? t("admin.v2.agent_disabled")
    : agentStatus === "failed"
      // A broken runtime outlives the machine being off — it is still what
      // the reader has to fix when they power it back on.
      ? t("status.failed", { defaultValue: "failed" })
      : !nodeOnline
        ? t("nodes.presence_offline")
        : agentStatus === "unknown"
          ? t("computer.runtime_no_signal")
          : t(`status.${agentStatus}`, { defaultValue: agentStatus });

  return (
    <li
      className={`computer-runtime-row tone-${tone}${disabled ? " is-disabled" : ""}`}
      data-agent={agent}
      data-presence={presence}
    >
      <i className="adm-agent-dot" aria-hidden="true" />
      <AgentMark agent={agent} size={14} className="computer-runtime-mark" />
      <span className="computer-runtime-name" translate="no">{labelForExecutor(agent)}</span>
      <span className="computer-runtime-state">{stateLabel}</span>
      <span className="computer-runtime-version code" translate="no">
        {version ?? node.agentDetails?.[agent]?.detail ?? ""}
      </span>
    </li>
  );
}
