"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ActionApprove, ActionEdit, ActionRemove, ActionToggle, AdminDelete } from "./icons";
import { deleteAgentPlacement, deleteEmployeeAgent, getControlPanelAgent, updateEmployeeAgent, updateOwnEmployeeAgent } from "../api";
import { agentLabel } from "../lib/plan";
import type { AgentPlacement, ControlPanelDaemonNodeRecord, EmployeeAgent, EmployeeRecord } from "../types";
import { useDialogs } from "@/components/ui/DialogProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ADMIN_AGENTS_KEY } from "../lib/adminHelpers";
import { EMPLOYEE_AGENTS_QUERY_KEY } from "../hooks/useEmployeeAgents";
import { formatRelativeTime, truncateId, agentAvailabilityTone } from "./admin/helpers";
import { AgentMark } from "./AgentMark";

export interface AgentProfilePanelProps {
  agent: EmployeeAgent;
  employees?: EmployeeRecord[];
  nodes?: ControlPanelDaemonNodeRecord[];
  canManage?: boolean;
  canEditMeta?: boolean;
  variant?: "admin" | "workspace";
  onAgentUpdated?: (agent: EmployeeAgent) => void;
  onAgentDeleted?: (agentId: string) => void;
  /** Shown in admin drawer when the caller can navigate to the workspace page. */
  onOpenWorkspace?: (agent: EmployeeAgent) => void;
  /** When true, dossier omits hero chrome duplicated by the drawer header. */
  embedInDrawer?: boolean;
}

function DossierIconButton({
  children,
  className = "",
  ...props
}: ComponentProps<"button">) {
  return (
    <Button variant="ghost"
      type="button"
      className={`workspace-dossier-icon-btn${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </Button>
  );
}

function placementStatusTone(status: AgentPlacement["status"]): string {
  if (status === "ready") return "good";
  if (status === "busy") return "info";
  if (status === "pending") return "warn";
  if (status === "failed" || status === "incompatible") return "bad";
  return "neutral";
}

export function AgentProfilePanel({
  agent,
  employees = [],
  nodes = [],
  canManage = false,
  canEditMeta = false,
  variant = "admin",
  onAgentUpdated,
  onAgentDeleted,
  onOpenWorkspace,
  embedInDrawer = false,
}: AgentProfilePanelProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const queryClient = useQueryClient();
  const canEditProfile = canManage || canEditMeta;

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPlacementId, setPendingPlacementId] = useState<string | null>(null);

  const previousAgentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (previousAgentIdRef.current === agent.id) return;
    previousAgentIdRef.current = agent.id;
    setRenaming(false);
    setEditingInstructions(false);
    setError(null);
    setSaving(false);
    setPendingPlacementId(null);
  }, [agent.id]);

  async function patchAgent(patch: Parameters<typeof updateEmployeeAgent>[1]) {
    if (canManage) {
      return updateEmployeeAgent(agent.id, patch);
    }
    return updateOwnEmployeeAgent(agent.id, {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
    });
  }

  function applyAgentUpdate(updated: EmployeeAgent) {
    queryClient.setQueryData(["admin", "agent", updated.id], { agent: updated });
    void queryClient.invalidateQueries({ queryKey: ADMIN_AGENTS_KEY });
    void queryClient.invalidateQueries({ queryKey: [EMPLOYEE_AGENTS_QUERY_KEY] });
    onAgentUpdated?.(updated);
  }

  function startRename() {
    setNameDraft(agent.displayName);
    setRenaming(true);
    setError(null);
  }

  async function handleRenameSave() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === agent.displayName) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await patchAgent({ displayName: trimmed });
      if (!result) return;
      applyAgentUpdate(result.agent);
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function startEditInstructions() {
    setInstructionsDraft(agent.instructions ?? "");
    setEditingInstructions(true);
    setError(null);
  }

  async function handleInstructionsSave() {
    const trimmed = instructionsDraft.trim();
    if (trimmed === (agent.instructions ?? "").trim()) {
      setEditingInstructions(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await patchAgent({ instructions: trimmed });
      if (!result) return;
      applyAgentUpdate(result.agent);
      setEditingInstructions(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled() {
    setSaving(true);
    setError(null);
    try {
      const result = await patchAgent({ enabled: !agent.enabled });
      if (!result) return;
      applyAgentUpdate(result.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAgent() {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  async function handleRemovePlacement(placement: AgentPlacement) {
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

  const owner = employees.find((employee) => employee.id === agent.employeeId);
  const ownerLabel = owner?.displayName || agent.employeeId;
  const activePlacements = agent.placements.filter((placement) => placement.desiredState !== "removed");
  const isWorkspace = variant === "workspace";

  if (isWorkspace) {
    return (
      <div
        className="workspace-profile-panel workspace-profile-dossier"
        data-executor={agent.executorKind}
      >
        <header className="workspace-dossier-hero">
          {!embedInDrawer ? (
            <span className="workspace-dossier-mark" aria-hidden="true">
              <AgentMark agent={agent.executorKind} size={20} />
            </span>
          ) : null}
          <p className="workspace-dossier-blurb">{t(`agent.${agent.executorKind}.blurb`)}</p>
          <div className="workspace-dossier-status">
            <span className={`workspace-status-pill tone-${agentAvailabilityTone(agent.availability)}`}>
              {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
            </span>
            {!embedInDrawer ? (
              <span className="workspace-dossier-runtime mono" translate="no">{agentLabel(agent.executorKind)}</span>
            ) : null}
          </div>
        </header>

        {canEditProfile ? (
          <section className="workspace-dossier-name" aria-labelledby="workspace-dossier-name-title">
            {embedInDrawer && !renaming ? (
              <DossierIconButton
                onClick={startRename}
                aria-label={t("admin.v2.edit_agent")}
                title={t("admin.v2.edit_agent")}
              >
                <ActionEdit size={14} aria-hidden="true" />
                <span>{t("admin.v2.edit_agent")}</span>
              </DossierIconButton>
            ) : (
              <>
                <div className="workspace-dossier-instructions-head">
                  <h3 id="workspace-dossier-name-title">{t("admin.v2.agent_name")}</h3>
                  {!renaming ? (
                    <DossierIconButton
                      onClick={startRename}
                      aria-label={t("admin.v2.edit_agent")}
                      title={t("admin.v2.edit_agent")}
                    >
                      <ActionEdit size={14} aria-hidden="true" />
                    </DossierIconButton>
                  ) : null}
                </div>
                {renaming ? (
                  <>
                    <Input
                      name="agent-display-name"
                      type="text"
                      aria-label={t("admin.v2.agent_name")}
                      autoFocus
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void handleRenameSave();
                        if (event.key === "Escape") setRenaming(false);
                      }}
                      disabled={saving}
                    />
                    <div className="adm-cred-inline-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRenaming(false)}
                        disabled={saving}
                      >
                        {t("admin.v2.cancel")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleRenameSave()}
                        disabled={saving}
                      >
                        {t("admin.v2.save")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="workspace-dossier-name-value" translate="no">{agent.displayName}</p>
                )}
              </>
            )}
          </section>
        ) : null}

        <section className="workspace-dossier-instructions" aria-labelledby="workspace-dossier-instructions-title">
          <div className="workspace-dossier-instructions-head">
            <h3 id="workspace-dossier-instructions-title">{t("agents_page.instructions_label")}</h3>
            {canEditProfile && !editingInstructions ? (
              <DossierIconButton
                onClick={startEditInstructions}
                aria-label={t("agents_page.edit_instructions")}
                title={t("agents_page.edit_instructions")}
              >
                <ActionEdit size={14} aria-hidden="true" />
              </DossierIconButton>
            ) : null}
          </div>
          {editingInstructions ? (
            <>
              <Textarea
                className="adm-instructions-input"
                name="agent-instructions"
                aria-label={t("agents_page.instructions_label")}
                rows={5}
                autoFocus
                value={instructionsDraft}
                onChange={(event) => setInstructionsDraft(event.target.value)}
                disabled={saving}
                placeholder={t("agents_page.instructions_placeholder")}
              />
              <div className="adm-cred-inline-actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingInstructions(false)}
                  disabled={saving}
                >
                  {t("admin.v2.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleInstructionsSave()}
                  disabled={saving}
                >
                  {t("admin.v2.save")}
                </Button>
              </div>
            </>
          ) : (
            <p className={`workspace-dossier-prose${agent.instructions?.trim() ? "" : " is-empty"}`}>
              {agent.instructions?.trim() ? agent.instructions.trim() : t("agents_page.instructions_empty")}
            </p>
          )}
        </section>

        <details className="workspace-dossier-details">
          <summary>{t("workspace.profile_details")}</summary>
          <div className="workspace-dossier-details-body">
            <span translate="no">@{agent.employeeId} · {agent.id}</span>
            <span>{t("admin.v2.agent_owner_label")}: @{ownerLabel}</span>
            <span>
              {t("admin.v2.agent_meta_version", { version: agent.version })}
              {" · "}
              {t("admin.v2.agent_meta_created", { time: formatRelativeTime(agent.createdAt, t) })}
              {" · "}
              {t("admin.v2.agent_meta_updated", { time: formatRelativeTime(agent.updatedAt, t) })}
            </span>
          </div>
        </details>

        {canEditProfile && error ? (
          <p className="adm-form-error" role="alert">{t("admin.v2.action_failed", { message: error })}</p>
        ) : null}

        {canManage || onOpenWorkspace ? (
          <div className="adm-drawer-section-actions">
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleToggleEnabled()}
                disabled={saving}
              >
                <ActionToggle size={14} aria-hidden="true" />
                {agent.enabled ? t("admin.v2.agent_disable_action") : t("admin.v2.agent_enable_action")}
              </Button>
            ) : null}
            {onOpenWorkspace ? (
              <Button type="button" variant="outline" onClick={() => onOpenWorkspace(agent)}>
                {t("agents_page.open_workspace")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {canManage ? (
          <>
            <div className="adm-drawer-section">
              <p className="workspace-dossier-section-title">{t("admin.v2.agent_placements_title")}</p>
              {activePlacements.length === 0 ? (
                <p className="adm-cred-empty">{t("admin.v2.no_runtime_placement")}</p>
              ) : (
                <ul className="adm-placement-list">
                  {activePlacements.map((placement) => {
                    const node = nodes.find((item) => item.id === placement.daemonNodeId);
                    const nodeMissing = nodes.length > 0 && !node;
                    const tone = placementStatusTone(placement.status);
                    return (
                      <li key={placement.id} className="adm-placement-item">
                        <span className={`adm-placement-dot tone-${tone}`} aria-hidden="true" />
                        <span className="adm-placement-body">
                          <span className="adm-placement-id mono" title={placement.daemonNodeId}>
                            {truncateId(placement.daemonNodeId)}
                          </span>
                          <span className="adm-placement-status-row">
                            <span className={`adm-placement-status tone-${tone}`}>
                              {t(`admin.v2.placement_status.${placement.status}`, { defaultValue: placement.status })}
                            </span>
                            {nodeMissing ? (
                              <span className="adm-placement-status tone-bad">{t("admin.v2.agents_node_missing")}</span>
                            ) : null}
                          </span>
                        </span>
                        <Button variant="ghost"
                          type="button"
                          className="adm-placement-remove"
                          onClick={() => void handleRemovePlacement(placement)}
                          disabled={pendingPlacementId !== null}
                          aria-label={t("admin.v2.remove_placement")}
                          title={t("admin.v2.remove_placement")}
                        >
                          <AdminDelete size={13} aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="adm-drawer-section">
              <p className="workspace-dossier-section-title">{t("admin.v2.danger_zone")}</p>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDeleteAgent()}
                disabled={saving}
              >
                <AdminDelete size={14} aria-hidden="true" />
                {t("admin.v2.delete_agent")}
              </Button>
              {error ? (
                <p className="adm-form-error" role="alert">{t("admin.v2.action_failed", { message: error })}</p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="workspace-profile-panel">
      <p className="workspace-profile-id mono" translate="no">
        @{agent.employeeId} · {agent.id}
      </p>

      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("admin.v2.agent_name")}</span>
        {renaming ? (
          <div className="adm-cred-value-line">
            <input
              className="adm-search-input"
              name="agent-display-name"
              type="text"
              aria-label={t("admin.v2.agent_name")}
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleRenameSave();
                if (event.key === "Escape") setRenaming(false);
              }}
              disabled={saving}
            />
            <Button variant="ghost"
              type="button"
              className="adm-copy-pill"
              onClick={() => void handleRenameSave()}
              disabled={saving}
              aria-label={t("admin.v2.save")}
              title={t("admin.v2.save")}
            >
              <ActionApprove size={14} aria-hidden="true" />
            </Button>
            <Button variant="ghost"
              type="button"
              className="adm-copy-pill"
              onClick={() => setRenaming(false)}
              disabled={saving}
              aria-label={t("admin.v2.cancel")}
              title={t("admin.v2.cancel")}
            >
              <ActionRemove size={14} aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <div className="adm-cred-value-line">
            <span className="adm-cred-value" translate="no">{agent.displayName}</span>
            {canEditProfile ? (
              <Button variant="ghost"
                type="button"
                className="adm-copy-pill"
                onClick={startRename}
                aria-label={t("admin.v2.edit_agent")}
                title={t("admin.v2.edit_agent")}
              >
                <ActionEdit size={14} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("agents_page.instructions_label")}</span>
        {editingInstructions ? (
          <div className="adm-cred-value-line adm-cred-value-line--stack">
            <textarea
              className="adm-search-input adm-instructions-input"
              name="agent-instructions"
              aria-label={t("agents_page.instructions_label")}
              rows={4}
              autoFocus
              value={instructionsDraft}
              onChange={(event) => setInstructionsDraft(event.target.value)}
              disabled={saving}
              placeholder={t("agents_page.instructions_placeholder")}
            />
            <div className="adm-cred-inline-actions">
              <Button variant="ghost"
                type="button"
                className="adm-copy-pill"
                onClick={() => void handleInstructionsSave()}
                disabled={saving}
                aria-label={t("admin.v2.save")}
                title={t("admin.v2.save")}
              >
                <ActionApprove size={14} aria-hidden="true" />
              </Button>
              <Button variant="ghost"
                type="button"
                className="adm-copy-pill"
                onClick={() => setEditingInstructions(false)}
                disabled={saving}
                aria-label={t("admin.v2.cancel")}
                title={t("admin.v2.cancel")}
              >
                <ActionRemove size={14} aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="adm-cred-value-line">
            <span className="adm-cred-value">
              {agent.instructions?.trim()
                ? agent.instructions.trim()
                : t("agents_page.instructions_empty")}
            </span>
            {canEditProfile ? (
              <Button variant="ghost"
                type="button"
                className="adm-copy-pill"
                onClick={startEditInstructions}
                aria-label={t("agents_page.edit_instructions")}
                title={t("agents_page.edit_instructions")}
              >
                <ActionEdit size={14} aria-hidden="true" />
              </Button>
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
        <span className={`adm-status-pill tone-${agentAvailabilityTone(agent.availability)}`}>
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

      {canManage || onOpenWorkspace ? (
        <div className="adm-drawer-section-actions">
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleToggleEnabled()}
              disabled={saving}
            >
              <ActionToggle size={14} aria-hidden="true" />
              {agent.enabled ? t("admin.v2.agent_disable_action") : t("admin.v2.agent_enable_action")}
            </Button>
          ) : null}
          {onOpenWorkspace ? (
            <Button type="button" variant="outline" onClick={() => onOpenWorkspace(agent)}>
              {t("agents_page.open_workspace")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {error && canEditProfile && !canManage ? (
        <p className="adm-form-error" role="alert">{t("admin.v2.action_failed", { message: error })}</p>
      ) : null}

      <div className="adm-drawer-section">
        <p className="adm-drawer-section-title">{t("admin.v2.agent_placements_title")}</p>
        {activePlacements.length === 0 ? (
          <p className="adm-cred-empty">{t("admin.v2.no_runtime_placement")}</p>
        ) : (
          <ul className="adm-placement-list">
            {activePlacements.map((placement) => {
              const node = nodes.find((item) => item.id === placement.daemonNodeId);
              const nodeMissing = nodes.length > 0 && !node;
              const tone = placementStatusTone(placement.status);
              return (
                <li key={placement.id} className={`adm-placement-item${canManage ? "" : " adm-placement-item--compact"}`}>
                  <span className={`adm-placement-dot tone-${tone}`} aria-hidden="true" />
                  <span className="adm-placement-body">
                    <span className="adm-placement-id mono" title={placement.daemonNodeId}>
                      {truncateId(placement.daemonNodeId)}
                    </span>
                    <span className="adm-placement-status-row">
                      <span className={`adm-placement-status tone-${tone}`}>
                        {t(`admin.v2.placement_status.${placement.status}`, { defaultValue: placement.status })}
                      </span>
                      {nodeMissing ? (
                        <span className="adm-placement-status tone-bad">{t("admin.v2.agents_node_missing")}</span>
                      ) : null}
                    </span>
                  </span>
                  {canManage ? (
                    <Button variant="ghost"
                      type="button"
                      className="adm-placement-remove"
                      onClick={() => void handleRemovePlacement(placement)}
                      disabled={pendingPlacementId !== null}
                      aria-label={t("admin.v2.remove_placement")}
                      title={t("admin.v2.remove_placement")}
                    >
                      <AdminDelete size={13} aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canManage ? (
        <div className="adm-drawer-section">
          <p className="adm-drawer-section-title">{t("admin.v2.danger_zone")}</p>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDeleteAgent()}
            disabled={saving}
          >
            <AdminDelete size={14} aria-hidden="true" />
            {t("admin.v2.delete_agent")}
          </Button>
          {error ? (
            <p className="adm-form-error" role="alert">{t("admin.v2.action_failed", { message: error })}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
