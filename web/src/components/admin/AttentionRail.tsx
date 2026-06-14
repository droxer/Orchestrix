"use client";

import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import type { DaemonNodeActiveRun } from "relay-core";
import { buildAttentionItems, isStale, type AttentionItem } from "./helpers";

interface AttentionRailProps {
  nodes: ControlPanelDaemonNodeRecord[];
}

interface RailEntry {
  key: string;
  kind: "run" | "error" | "stale-run" | "quiet";
  tone: "info" | "bad" | "warn" | "neutral";
  title: string;
  meta: string;
  body: string;
}

function attentionTone(kind: AttentionItem["kind"]): RailEntry["tone"] {
  if (kind === "error") return "bad";
  if (kind === "stale-run") return "warn";
  return "neutral";
}

function attentionTitle(kind: AttentionItem["kind"], t: TFunction): string {
  if (kind === "error") return t("admin.kind_error");
  if (kind === "stale-run") return t("admin.kind_stale_run");
  return t("admin.kind_quiet");
}

function buildEntries(nodes: ControlPanelDaemonNodeRecord[], t: TFunction): RailEntry[] {
  const runs: Array<{ run: DaemonNodeActiveRun; employeeId?: string }> = [];
  for (const node of nodes) {
    if (isStale(node)) continue;
    for (const run of node.activeRuns) {
      runs.push({ run, employeeId: node.employeeId });
    }
  }

  const runEntries: RailEntry[] = runs.map(({ run, employeeId }) => ({
    key: `run:${run.commandId}`,
    kind: "run",
    tone: "info",
    title: t("admin.run_title", { agent: run.agent, mode: t(`mode.${run.mode}`, { defaultValue: run.mode }) }),
    meta: employeeId ? `@${employeeId}` : t("admin.unassigned"),
    body: run.taskGoal || t("admin.v2.active_run_default"),
  }));

  const attentionEntries: RailEntry[] = buildAttentionItems(nodes, t).map((item, i) => ({
    key: `att:${item.nodeId}:${item.kind}:${i}`,
    kind: item.kind,
    tone: attentionTone(item.kind),
    title: attentionTitle(item.kind, t),
    meta: item.employeeId ? `@${item.employeeId}` : t("admin.unassigned"),
    body: item.body,
  }));

  return [...runEntries, ...attentionEntries].slice(0, 24);
}

export function AttentionRail({ nodes }: AttentionRailProps) {
  const { t } = useTranslation();
  const entries = buildEntries(nodes, t);
  const runCount = entries.filter((entry) => entry.kind === "run").length;
  const attentionCount = entries.length - runCount;

  return (
    <aside className="adm-rail" aria-label={t("admin.v2.rail_label")}>
      <header className="adm-rail-head">
        <h2 className="adm-rail-title">{t("admin.v2.rail_title")}</h2>
        <span className="adm-rail-counts mono">
          <span className="tone-info">{runCount}</span>
          <span aria-hidden="true">·</span>
          <span className={attentionCount > 0 ? "tone-bad" : "tone-muted"}>{attentionCount}</span>
        </span>
      </header>
      {entries.length === 0 ? (
        <div className="adm-rail-empty">{t("admin.v2.rail_empty")}</div>
      ) : (
        <ul className="adm-rail-list">
          {entries.map((entry) => (
            <li key={entry.key} className={`adm-rail-item tone-${entry.tone}`}>
              <span className="adm-rail-item-head">
                <span className="adm-rail-item-title">{entry.title}</span>
                <span className="adm-rail-item-meta mono" translate="no">
                  {entry.meta}
                </span>
              </span>
              <p className="adm-rail-item-body">{entry.body}</p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
