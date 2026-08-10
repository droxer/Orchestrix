"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { ActionApprove, ActionEdit, ActionRemove, ActionToggle, AdminDelete } from "./icons";
import {
  deleteAgentPlacement,
  deleteAgentProfileImage,
  deleteEmployeeAgent,
  getControlPanelAgent,
  updateAgentProfileImage,
  updateEmployeeAgent,
  updateOwnEmployeeAgent,
} from "../api";
import { agentLabel } from "../lib/plan";
import { AGENT_ROLE_OPTIONS } from "../types";
import type { AgentPlacement, AgentRole, ControlPanelDaemonNodeRecord, EmployeeAgent, EmployeeRecord } from "../types";
import { useDialogs } from "@/components/ui/DialogProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_AGENTS_KEY } from "../lib/adminHelpers";
import { EMPLOYEE_AGENTS_QUERY_KEY } from "../hooks/useEmployeeAgents";
import { formatRelativeTime, agentAvailabilityTone } from "./admin/helpers";
import { TonePill } from "./StatusPill";
import { IdentityMonogram } from "./IdentityMonogram";
import { AgentPersonalityEditor } from "./AgentPersonalityEditor";
import { PlacementList } from "./PlacementList";
import { describeAgentPlacements } from "../lib/agentPlacements";
import { ProfileImagePicker } from "./ProfileImagePicker";
import { pathForAppState } from "../lib/appRoute";

export interface AgentProfilePanelProps {
  agent: EmployeeAgent;
  employees?: EmployeeRecord[];
  nodes?: ControlPanelDaemonNodeRecord[];
  canManage?: boolean;
  canEditMeta?: boolean;
  variant?: "admin" | "workspace";
  onAgentUpdated?: (agent: EmployeeAgent) => void;
  onAgentDeleted?: (agentId: string) => void;
  /** Reports unsaved rename/personality drafts so parents can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Shown in admin drawer when the caller can navigate to the workspace page. */
  onOpenWorkspace?: (agent: EmployeeAgent) => void;
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

export function AgentProfilePanel({
  agent,
  employees = [],
  nodes = [],
  canManage = false,
  canEditMeta = false,
  variant = "admin",
  onAgentUpdated,
  onAgentDeleted,
  onDirtyChange,
  onOpenWorkspace,
}: AgentProfilePanelProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const queryClient = useQueryClient();
  const canEditProfile = canManage || canEditMeta;

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingPersonality, setEditingPersonality] = useState(false);
  const [personalityDraft, setPersonalityDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPlacementId, setPendingPlacementId] = useState<string | null>(null);

  const dirtyDraft = (renaming && nameDraft.trim() !== agent.displayName.trim())
    || (editingPersonality && personalityDraft.trim() !== (agent.instructions ?? "").trim());
  const dirtyDraftRef = useRef(false);
  dirtyDraftRef.current = dirtyDraft;
  useUnsavedChangesGuard(dirtyDraft && !saving);

  useEffect(() => {
    onDirtyChange?.(dirtyDraft);
  }, [dirtyDraft, onDirtyChange]);

  const renameEditButtonRef = useRef<HTMLButtonElement>(null);
  const renameActiveRef = useRef(false);
  useEffect(() => {
    if (renameActiveRef.current && !renaming) {
      renameEditButtonRef.current?.focus();
    }
    renameActiveRef.current = renaming;
  }, [renaming]);

  const previousAgentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (previousAgentIdRef.current === agent.id) return;
    const hadDirtyDraft = dirtyDraftRef.current;
    previousAgentIdRef.current = agent.id;
    const resetEditingState = () => {
      setRenaming(false);
      setEditingPersonality(false);
      setError(null);
      setSaving(false);
      setPendingPlacementId(null);
    };
    // Hold the draft until the owner confirms the discard — switching rows
    // must not silently drop unsaved rename/personality edits.
    if (!hadDirtyDraft) {
      resetEditingState();
      return;
    }
    void confirm({
      title: t("unsaved.title"),
      message: t("unsaved.message"),
      confirmLabel: t("unsaved.confirm"),
      cancelLabel: t("dialog.cancel"),
      tone: "danger",
    }).then((ok) => {
      if (ok) resetEditingState();
    });
  }, [agent.id, confirm, t]);

  async function patchAgent(patch: Parameters<typeof updateEmployeeAgent>[1]) {
    if (canManage) {
      return updateEmployeeAgent(agent.id, patch);
    }
    return updateOwnEmployeeAgent(agent.id, {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
      ...(patch.defaultRole !== undefined ? { defaultRole: patch.defaultRole } : {}),
    });
  }

  function applyAgentUpdate(updated: EmployeeAgent) {
    queryClient.setQueryData(["admin", "agent", updated.id], { agent: updated });
    void queryClient.invalidateQueries({ queryKey: ADMIN_AGENTS_KEY });
    void queryClient.invalidateQueries({ queryKey: [EMPLOYEE_AGENTS_QUERY_KEY] });
    onAgentUpdated?.(updated);
  }

  async function handleRoleChange(next: string) {
    // Empty means "no role": the agent contributes without a specialization.
    const role = next ? (next as AgentRole) : undefined;
    if ((agent.defaultRole ?? "") === (role ?? "")) return;
    setSaving(true);
    setError(null);
    try {
      const result = await patchAgent({ defaultRole: role ?? null });
      applyAgentUpdate(result.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
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

  function startEditPersonality() {
    setPersonalityDraft(agent.instructions ?? "");
    setEditingPersonality(true);
    setError(null);
  }

  async function handlePersonalitySave() {
    const trimmed = personalityDraft.trim();
    if (trimmed === (agent.instructions ?? "").trim()) {
      setEditingPersonality(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await patchAgent({ instructions: trimmed });
      if (!result) return;
      applyAgentUpdate(result.agent);
      setEditingPersonality(false);
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

  async function handleImageUpload(dataUrl: string) {
    setSaving(true);
    setError(null);
    try {
      const result = await updateAgentProfileImage(agent.id, dataUrl);
      applyAgentUpdate(result.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleImageRemove() {
    setSaving(true);
    setError(null);
    try {
      const result = await deleteAgentProfileImage(agent.id);
      applyAgentUpdate(result.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAgent() {
    const ok = await confirm({
      title: t("admin.v2.delete_agent_confirm", { name: agent.displayName }),
      message: t("admin.v2.delete_agent_message"),
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
      title: t("admin.v2.remove_placement_confirm", {
        node: node?.displayName || placement.nodeDisplayName || placement.daemonNodeId,
      }),
      message: t("admin.v2.remove_placement_message"),
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
  const ownerDisplay = owner ? owner.displayName : `@${agent.employeeId}`;
  const placementDescriptions = describeAgentPlacements(agent.placements);
  const isWorkspace = variant === "workspace";

  if (isWorkspace) {
    /* The profile tab carries only what you can CHANGE about the record —
       portrait, name, role, instructions. Runtime, computer, availability,
       and id are printed once by the RecordBand above every tab, so
       restating them here (as the old hero and the collapsed "Details"
       disclosure both did) would put the same facts on screen twice. */
    return (
      <div className="workspace-profile-panel workspace-profile-dossier">
        <div className="workspace-dossier-doc">
          <AgentPersonalityEditor
            value={agent.instructions ?? ""}
            draft={personalityDraft}
            editing={editingPersonality}
            editable={canEditProfile}
            saving={saving}
            onStartEdit={startEditPersonality}
            onDraftChange={setPersonalityDraft}
            onCancel={() => setEditingPersonality(false)}
            onSave={() => void handlePersonalitySave()}
          />
        </div>

        <aside className="workspace-dossier-rail" aria-label={t("workspace.identity_label")}>
          <div className="workspace-dossier-portrait">
            <ProfileImagePicker
              imageUrl={agent.profileImageUrl}
              name={agent.displayName}
              fallback={<IdentityMonogram name={agent.displayName} size={22} />}
              editable={canEditProfile}
              disabled={saving}
              onUpload={handleImageUpload}
              onRemove={handleImageRemove}
            />
          </div>

          <div className="workspace-dossier-field">
            <span className="workspace-dossier-field-label" id="agent-name-label">
              {t("admin.v2.agent_name")}
            </span>
            {renaming ? (
              <div className="workspace-dossier-rename">
                <Input
                  name="agent-display-name"
                  type="text"
                  aria-label={t("admin.v2.agent_name")}
                  autoComplete="off"
                  autoFocus
                  maxLength={64}
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleRenameSave();
                    if (event.key === "Escape") setRenaming(false);
                  }}
                  disabled={saving}
                />
                <div className="workspace-dossier-rename-actions">
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
              </div>
            ) : (
              <div className="workspace-dossier-name-row">
                <span className="workspace-dossier-name-value" translate="no">{agent.displayName}</span>
                {canEditProfile ? (
                  <DossierIconButton
                    ref={renameEditButtonRef}
                    onClick={startRename}
                    aria-label={t("admin.v2.edit_agent")}
                    title={t("admin.v2.edit_agent")}
                  >
                    <ActionEdit size={14} aria-hidden="true" />
                  </DossierIconButton>
                ) : null}
              </div>
            )}
          </div>

          <div className="workspace-dossier-field">
            <label className="workspace-dossier-field-label" htmlFor="agent-default-role">
              {t("admin.v2.agent_role_label")}
            </label>
            {canEditProfile ? (
              <select
                id="agent-default-role"
                className="workspace-dossier-role-select"
                value={agent.defaultRole ?? ""}
                disabled={saving}
                onChange={(event) => void handleRoleChange(event.target.value)}
              >
                <option value="">{t("admin.v2.agent_role_none")}</option>
                {AGENT_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {t(`admin.v2.agent_role.${role}`, { defaultValue: role })}
                  </option>
                ))}
              </select>
            ) : (
              <span className="workspace-dossier-field-value">
                {agent.defaultRole
                  ? t(`admin.v2.agent_role.${agent.defaultRole}`, { defaultValue: agent.defaultRole })
                  : t("admin.v2.agent_role_none")}
              </span>
            )}
          </div>

          <p className="workspace-dossier-stamp">
            {t("admin.v2.agent_meta_version", { version: agent.version })}
            {" · "}
            {t("admin.v2.agent_meta_created", { time: formatRelativeTime(agent.createdAt, t) })}
            {" · "}
            {t("admin.v2.agent_meta_updated", { time: formatRelativeTime(agent.updatedAt, t) })}
          </p>

          {canEditProfile && error ? (
            <p className="adm-form-error" role="alert">{t("admin.v2.action_failed", { message: error })}</p>
          ) : null}
        </aside>

        {/* Management lives below the two columns and spans both — it acts on
            the whole record, not on the document or the identity rail. */}
        {canManage || onOpenWorkspace ? (
          <div className="workspace-dossier-admin">
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
                <a
                  data-slot="link-button"
                  href={pathForAppState({ route: "agents", mobileView: "chat", sessionId: null, agentWorkspaceId: agent.id })}
                  className={buttonVariants({ variant: "outline" })}
                  onClick={(event) => {
                    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
                    event.preventDefault();
                    onOpenWorkspace(agent);
                  }}
                >
                  {t("agents_page.open_workspace")}
                </a>
              ) : null}
            </div>

            {canManage ? (
              <>
                <div className="adm-drawer-section">
                  <p className="workspace-dossier-section-title">{t("admin.v2.agent_placements_title")}</p>
                  {placementDescriptions.length === 0 ? (
                    <p className="adm-cred-empty">{t("admin.v2.no_runtime_placement")}</p>
                  ) : (
                    <PlacementList
                      descriptions={placementDescriptions}
                      canManage={canManage}
                      pendingPlacementId={pendingPlacementId}
                      onRemove={(placement) => void handleRemovePlacement(placement)}
                      nodeMissingFor={(description) => nodes.length > 0
                        && !nodes.some((node) => node.id === description.placement.daemonNodeId)}
                    />
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
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="workspace-profile-panel">
      <p className="workspace-profile-id code" translate="no">
        @{agent.employeeId} · {agent.id}
      </p>

      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("admin.v2.agent_name")}</span>
        {renaming ? (
          <div className="adm-cred-value-line">
            <Input
              name="agent-display-name"
              type="text"
              aria-label={t("admin.v2.agent_name")}
              autoComplete="off"
              autoFocus
              maxLength={64}
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

      <AgentPersonalityEditor
        value={agent.instructions ?? ""}
        draft={personalityDraft}
        editing={editingPersonality}
        editable={canEditProfile}
        saving={saving}
        onStartEdit={startEditPersonality}
        onDraftChange={setPersonalityDraft}
        onCancel={() => setEditingPersonality(false)}
        onSave={() => void handlePersonalitySave()}
      />

      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("admin.v2.agent_runtime")}</span>
        <span className="adm-cred-value code" translate="no">{agentLabel(agent.executorKind)}</span>
      </div>

      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("admin.v2.agent_owner_label")}</span>
        <span className="adm-cred-value code" translate="no">{ownerDisplay}</span>
      </div>

      <div className="adm-cred-row">
        <span className="adm-cred-label">{t("admin.v2.agent_availability_label")}</span>
        <TonePill
          tone={agentAvailabilityTone(agent.availability)}
          label={t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
          live={agentAvailabilityTone(agent.availability) === "info"}
        />
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
            <a
              data-slot="link-button"
              href={pathForAppState({ route: "agents", mobileView: "chat", sessionId: null, agentWorkspaceId: agent.id })}
              className={buttonVariants({ variant: "outline" })}
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                onOpenWorkspace(agent);
              }}
            >
              {t("agents_page.open_workspace")}
            </a>
          ) : null}
        </div>
      ) : null}

      {error && canEditProfile && !canManage ? (
        <p className="adm-form-error" role="alert">{t("admin.v2.action_failed", { message: error })}</p>
      ) : null}

      <div className="adm-drawer-section">
        <p className="adm-drawer-section-title">{t("admin.v2.agent_placements_title")}</p>
        {placementDescriptions.length === 0 ? (
          <p className="adm-cred-empty">{t("admin.v2.no_runtime_placement")}</p>
        ) : (
          <PlacementList
            descriptions={placementDescriptions}
            canManage={canManage}
            pendingPlacementId={pendingPlacementId}
            onRemove={(placement) => void handleRemovePlacement(placement)}
            nodeMissingFor={(description) => nodes.length > 0
              && !nodes.some((node) => node.id === description.placement.daemonNodeId)}
          />
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
