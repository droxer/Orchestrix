"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Pencil, Power, Trash2, X } from "lucide-react";
import { deleteAgentPlacement, deleteEmployeeAgent, getControlPanelAgent, updateEmployeeAgent } from "../../api";
import { agentLabel } from "../../lib/plan";
import type { AgentPlacement, ControlPanelDaemonNodeRecord, EmployeeAgent, EmployeeRecord } from "../../types";
import { useDialogs } from "@/components/ui/DialogProvider";
import { Drawer } from "./Drawer";
import { ADMIN_AGENTS_KEY } from "./AgentsView";
import { formatRelativeTime, truncateId } from "./helpers";

interface AgentProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  agentId: string | null;
  /** Pre-loaded agent data (e.g. from the employee's own agent list). When
   *  provided, skips the admin-only `/cp/agents/{id}` fetch entirely — needed
   *  because non-admin employees can't call that route. */
  agent?: EmployeeAgent | null;
  employees?: EmployeeRecord[];
  nodes?: ControlPanelDaemonNodeRecord[];
  /** Hides rename/enable-disable/delete/remove-placement actions. Defaults to
   *  true (admin console usage); pass false for the employee-facing agents page,
   *  since employees have no write access to their own logical agent record. */
  canManage?: boolean;
  onAgentDeleted?: (agentId: string) => void;
}

function placementStatusTone(status: AgentPlacement["status"]): string {
  if (status === "ready") return "good";
  if (status === "busy") return "info";
  if (status === "pending") return "warn";
  if (status === "failed" || status === "incompatible") return "bad";
  return "neutral";
}

export function AgentProfileDrawer({
  open,
  onClose,
  agentId,
  agent: presetAgent,
  employees = [],
  nodes = [],
  canManage = true,
  onAgentDeleted,
}: AgentProfileDrawerProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const queryClient = useQueryClient();

  const agentQuery = useQuery({
    queryKey: ["admin", "agent", agentId] as const,
    queryFn: ({ signal }) => getControlPanelAgent(agentId as string, signal),
    enabled: open && agentId !== null && !presetAgent,
  });
  const agent = presetAgent ?? agentQuery.data?.agent ?? null;

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPlacementId, setPendingPlacementId] = useState<string | null>(null);

  const previousAgentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      previousAgentIdRef.current = null;
      return;
    }
    if (previousAgentIdRef.current === agentId) return;
    previousAgentIdRef.current = agentId;
    setRenaming(false);
    setError(null);
    setSaving(false);
    setPendingPlacementId(null);
  }, [open, agentId]);

  function applyAgentUpdate(updated: EmployeeAgent) {
    queryClient.setQueryData(["admin", "agent", updated.id], { agent: updated });
    void queryClient.invalidateQueries({ queryKey: ADMIN_AGENTS_KEY });
  }

  function startRename() {
    if (!agent) return;
    setNameDraft(agent.displayName);
    setRenaming(true);
    setError(null);
  }

  async function handleRenameSave() {
    if (!agent) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === agent.displayName) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await updateEmployeeAgent(agent.id, { displayName: trimmed });
      applyAgentUpdate(result.agent);
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled() {
    if (!agent) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateEmployeeAgent(agent.id, { enabled: !agent.enabled });
      applyAgentUpdate(result.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAgent() {
    if (!agent) return;
    const ok = await confirm({
      title: t("admin.v2.delete_agent_confirm", { name: agent.displayName }),
      confirmLabel: t("admin.v2.delete_agent"),
      tone: "danger",
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await deleteEmployeeAgent(agent.id);
      void queryClient.invalidateQueries({ queryKey: ADMIN_AGENTS_KEY });
      onAgentDeleted?.(agent.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  async function handleRemovePlacement(placement: AgentPlacement) {
    if (!agent) return;
    const node = nodes.find((item) => item.id === placement.daemonNodeId);
    const ok = await confirm({
      title: t("admin.v2.remove_placement_confirm", { node: node ? truncateId(node.id) : placement.daemonNodeId }),
      confirmLabel: t("admin.v2.remove_placement"),
      tone: "danger",
    });
    if (!ok) return;
    setPendingPlacementId(placement.id);
    setError(null);
    try {
      await deleteAgentPlacement(placement.id);
      const refreshed = await getControlPanelAgent(agent.id);
      applyAgentUpdate(refreshed.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingPlacementId(null);
    }
  }

  if (!agentId || !agent) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        title={t("admin.v2.section_agent_profile")}
        closeLabel={t("admin.v2.close_drawer")}
        ariaLabel={t("admin.v2.section_agent_profile")}
        layer={1}
      >
        {agentQuery.isError ? (
          <p className="adm-cred-empty">{t("admin.v2.agents_load_error")}</p>
        ) : (
          <p className="adm-cred-empty">{t("admin.v2.no_node_selected")}</p>
        )}
      </Drawer>
    );
  }

  const owner = employees.find((employee) => employee.id === agent.employeeId);
  const ownerLabel = owner?.displayName || agent.employeeId;
  const activePlacements = agent.placements.filter((placement) => placement.desiredState !== "removed");

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("admin.v2.section_agent_profile")}
      subtitle={
        <span className="mono" translate="no">
          @{agent.employeeId} · {agent.id}
        </span>
      }
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={t("admin.v2.section_agent_profile")}
      layer={1}
      width={520}
    >
      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("admin.v2.agent_name")}</span>
        {renaming ? (
          <div className="adm-cred-value-line">
            <input
              className="adm-search-input"
              name="agent-display-name"
              type="text"
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleRenameSave();
                if (event.key === "Escape") setRenaming(false);
              }}
              disabled={saving}
            />
            <button
              type="button"
              className="adm-copy-pill"
              onClick={() => void handleRenameSave()}
              disabled={saving}
              aria-label={t("admin.v2.save")}
              title={t("admin.v2.save")}
            >
              <Check size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="adm-copy-pill"
              onClick={() => setRenaming(false)}
              disabled={saving}
              aria-label={t("admin.v2.cancel")}
              title={t("admin.v2.cancel")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="adm-cred-value-line">
            <span className="adm-cred-value" translate="no">{agent.displayName}</span>
            {canManage ? (
              <button
                type="button"
                className="adm-copy-pill"
                onClick={startRename}
                aria-label={t("admin.v2.edit_agent")}
                title={t("admin.v2.edit_agent")}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("admin.v2.agent_runtime")}</span>
        <span className="adm-cred-value mono" translate="no">{agentLabel(agent.executorKind)}</span>
      </div>

      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("admin.v2.agent_owner_label")}</span>
        <span className="adm-cred-value mono" translate="no">@{ownerLabel}</span>
      </div>

      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("admin.v2.agent_availability_label")}</span>
        <span className={`adm-status-pill tone-${agent.availability === "ready" ? "good" : agent.availability === "busy" ? "info" : agent.availability === "pending" ? "warn" : "neutral"}`}>
          <span className="adm-status-dot" aria-hidden="true" />
          {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
        </span>
      </div>

      <p className="adm-cred-note">
        {t("admin.v2.agent_meta_version", { version: agent.version })}
        {" · "}
        {t("admin.v2.agent_meta_created", { time: formatRelativeTime(agent.createdAt, t) })}
        {" · "}
        {t("admin.v2.agent_meta_updated", { time: formatRelativeTime(agent.updatedAt, t) })}
      </p>

      {canManage ? (
        <div className="adm-cred-actions adm-cred-actions--row">
          <button
            type="button"
            className="adm-cred-action-button"
            onClick={() => void handleToggleEnabled()}
            disabled={saving}
          >
            <Power size={14} aria-hidden="true" />
            {agent.enabled ? t("admin.v2.agent_disable_action") : t("admin.v2.agent_enable_action")}
          </button>
        </div>
      ) : null}

      <div className="adm-cred-actions">
        <p className="adm-cred-actions-title">{t("admin.v2.agent_placements_title")}</p>
        {activePlacements.length === 0 ? (
          <p className="adm-cred-empty">{t("admin.v2.no_runtime_placement")}</p>
        ) : (
          <ul className="adm-agent-toggle-list">
            {activePlacements.map((placement) => {
              const node = nodes.find((item) => item.id === placement.daemonNodeId);
              const nodeMissing = nodes.length > 0 && !node;
              const tone = placementStatusTone(placement.status);
              return (
                <li key={placement.id} className="adm-agent-toggle-item">
                  <div className="adm-agent-toggle-row">
                    <div className="adm-agent-toggle-meta">
                      <span className="adm-agent-toggle-name mono" title={placement.daemonNodeId}>
                        {truncateId(placement.daemonNodeId)}
                      </span>
                      <span className={`adm-agent-chip tone-${tone}`}>
                        {t(`admin.v2.placement_status.${placement.status}`, { defaultValue: placement.status })}
                      </span>
                      {nodeMissing ? (
                        <span className="adm-agent-chip tone-bad">{t("admin.v2.agents_node_missing")}</span>
                      ) : null}
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        className="adm-cred-action-button danger"
                        onClick={() => void handleRemovePlacement(placement)}
                        disabled={pendingPlacementId !== null}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        {t("admin.v2.remove_placement")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canManage ? (
        <div className="adm-cred-actions">
          <p className="adm-cred-actions-title">{t("admin.v2.danger_zone")}</p>
          <button
            type="button"
            className="adm-cred-action-button danger"
            onClick={() => void handleDeleteAgent()}
            disabled={saving}
          >
            {t("admin.v2.delete_agent")}
          </button>
          {error ? (
            <p className="adm-cred-action-error">{t("admin.v2.action_failed", { message: error })}</p>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
