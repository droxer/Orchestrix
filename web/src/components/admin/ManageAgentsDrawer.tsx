"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateControlPanelDaemonNodeDisabledAgents } from "../../api";
import {
  disabledSetsEqual,
  newlyDisabledReadyAgents,
  normalizeDisabledAgentsPayload,
  shouldSnapshotDisabledAgents,
} from "../../lib/manageAgents";
import { AGENT_NAMES } from "../../types";
import type { AgentName, ControlPanelDaemonNodeRecord } from "../../types";
import { useDialogs } from "@/components/ui/DialogProvider";
import { Drawer } from "./Drawer";
import { agentStatusTone } from "./helpers";

interface ManageAgentsDrawerProps {
  open: boolean;
  onClose: () => void;
  node: ControlPanelDaemonNodeRecord | null;
  onUpdated: (node: ControlPanelDaemonNodeRecord) => void;
}

export function ManageAgentsDrawer({ open, onClose, node, onUpdated }: ManageAgentsDrawerProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const [initialDisabled, setInitialDisabled] = useState<Set<AgentName>>(() => new Set());
  const [disabled, setDisabled] = useState<Set<AgentName>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Snapshot the saved state when the drawer opens or the target node changes.
  // Intentionally NOT depending on node.disabledAgents identity — the admin
  // fleet poll replaces the array every 2s, which would wipe pending toggles.
  const nodeId = node?.id ?? null;
  const previousNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldSnapshotDisabledAgents(open, previousNodeIdRef.current, nodeId)) {
      if (!open) previousNodeIdRef.current = null;
      return;
    }
    previousNodeIdRef.current = nodeId;
    const snapshot = new Set((node?.disabledAgents ?? []) as AgentName[]);
    setInitialDisabled(snapshot);
    setDisabled(new Set(snapshot));
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeId]);

  function toggle(agent: AgentName) {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  }

  async function handleSave() {
    if (!node) return;
    const newlyDisabledReady = newlyDisabledReadyAgents(
      initialDisabled,
      disabled,
      node.agents,
    );
    if (newlyDisabledReady.length > 0) {
      const ok = await confirm({
        title: t("admin.v2.manage_agents_disable_confirm", {
          agents: newlyDisabledReady.join(", "),
        }),
        tone: "danger",
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await updateControlPanelDaemonNodeDisabledAgents(
        node.id,
        normalizeDisabledAgentsPayload(disabled),
      );
      onUpdated(result.node);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!node) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        title={t("admin.v2.manage_agents_title")}
        closeLabel={t("admin.v2.close_drawer")}
        ariaLabel={t("admin.v2.manage_agents_title")}
        layer={1}
      >
        <p className="adm-cred-empty">{t("admin.v2.no_node_selected")}</p>
      </Drawer>
    );
  }

  const dirty = !disabledSetsEqual(disabled, initialDisabled);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("admin.v2.manage_agents_title")}
      subtitle={
        <span className="mono" translate="no">
          {node.employeeId ? `@${node.employeeId}` : t("admin.unassigned")} · {node.id}
        </span>
      }
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.manage_agents_title")}
      layer={1}
    >
      <p className="adm-cred-note">{t("admin.v2.manage_agents_help")}</p>
      <ul className="adm-agent-toggle-list">
        {AGENT_NAMES.map((agent) => {
          const agentStatus = node.agents[agent] ?? "unknown";
          const tone = agentStatusTone(agentStatus);
          const isEnabled = !disabled.has(agent);
          const inventory = node.agentInventory?.[agent];
          const skills = inventory?.skills ?? [];
          const mcpServers = inventory?.mcpServers ?? [];
          return (
            <li key={agent} className="adm-agent-toggle-item">
              <div className="adm-agent-toggle-row">
                <div className="adm-agent-toggle-meta">
                  <span className="adm-agent-toggle-name" translate="no">{agent}</span>
                  <span className={`adm-agent-chip tone-${tone}`}>{t(`status.${agentStatus}`, { defaultValue: agentStatus })}</span>
                </div>
                <label className="adm-agent-toggle-switch">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => toggle(agent)}
                    disabled={saving}
                    aria-label={
                      isEnabled
                        ? t("admin.v2.disable_agent", { agent })
                        : t("admin.v2.enable_agent", { agent })
                    }
                  />
                  <span>{isEnabled ? t("admin.v2.agent_enabled") : t("admin.v2.agent_disabled")}</span>
                </label>
              </div>
              <div className="adm-agent-inventory">
                {skills.length === 0 && mcpServers.length === 0 ? (
                  <span className="adm-agent-inventory-empty">{t("admin.v2.agent_no_inventory")}</span>
                ) : (
                  <>
                    {skills.length > 0 && (
                      <div className="adm-agent-inventory-group">
                        <span className="adm-agent-inventory-label">{t("admin.v2.agent_skills", { count: skills.length })}</span>
                        <span className="adm-agent-inventory-pills">
                          {skills.map((skill) => (
                            <span key={`${skill.namespace ?? ""}/${skill.name}`} className="adm-agent-inventory-pill" title={skill.description ?? skill.name}>
                              {skill.name}
                            </span>
                          ))}
                        </span>
                      </div>
                    )}
                    {mcpServers.length > 0 && (
                      <div className="adm-agent-inventory-group">
                        <span className="adm-agent-inventory-label">{t("admin.v2.agent_mcp", { count: mcpServers.length })}</span>
                        <span className="adm-agent-inventory-pills">
                          {mcpServers.map((server) => (
                            <span key={server.name} className="adm-agent-inventory-pill" title={server.command ?? server.name}>
                              {server.name}
                            </span>
                          ))}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="adm-cred-actions adm-cred-actions--row">
        <button
          type="button"
          className="adm-cred-action-button primary"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
        >
          {saving ? t("admin.v2.saving") : t("admin.v2.save")}
        </button>
        <button
          type="button"
          className="adm-cred-action-button"
          onClick={onClose}
          disabled={saving}
        >
          {t("admin.v2.cancel")}
        </button>
        {error ? (
          <p className="adm-cred-action-error">{t("admin.v2.action_failed", { message: error })}</p>
        ) : null}
      </div>
    </Drawer>
  );
}
