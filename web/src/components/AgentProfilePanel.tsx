"use client";

import { useEffect, useRef, useState } from "react";
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
import type { AgentPlacement, ControlPanelDaemonNodeRecord, EmployeeAgent, EmployeeRecord } from "../types";
import { useDialogs } from "@/components/ui/DialogProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_AGENTS_KEY } from "../lib/adminHelpers";
import { EMPLOYEE_AGENTS_QUERY_KEY } from "../hooks/useEmployeeAgents";
import { formatRelativeTime, agentAvailabilityTone } from "./admin/helpers";
import { TonePill } from "./StatusPill";
import { IdentityMark } from "./IdentityMark";
import { AgentProfileEditor } from "./AgentProfileEditor";
import { LegacyPersonalityEditor } from "./LegacyPersonalityEditor";
import { PlacementList } from "./PlacementList";
import { describeAgentPlacements, placementRuntimeNodeId } from "../lib/agentPlacements";
import { ProfileImagePicker } from "./ProfileImagePicker";

export interface AgentProfilePanelProps {
  agent: EmployeeAgent;
  employees?: EmployeeRecord[];
  nodes?: ControlPanelDaemonNodeRecord[];
  canManage?: boolean;
  canEditMeta?: boolean;
  variant?: "admin" | "detail";
  onAgentUpdated?: (agent: EmployeeAgent) => void;
  onAgentDeleted?: (agentId: string) => void;
  /** Reports unsaved rename/personality drafts so parents can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
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
}: AgentProfilePanelProps) {
  const { t } = useTranslation();
  const { confirm } = useDialogs();
  const queryClient = useQueryClient();
  const canEditProfile = canManage || canEditMeta;

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingPersonality, setEditingPersonality] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [personalityDraft, setPersonalityDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPlacementId, setPendingPlacementId] = useState<string | null>(null);

  const dirtyDraft = (renaming && nameDraft.trim() !== agent.displayName.trim())
    || (editingPersonality && personalityDraft.trim() !== (agent.instructions ?? "").trim())
    || (editingProfile && (
      nameDraft.trim() !== agent.displayName.trim()
      || personalityDraft.trim() !== (agent.instructions ?? "").trim()
    ));
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
      setEditingProfile(false);
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

  function startEditPersonality() {
    setPersonalityDraft(agent.instructions ?? "");
    setEditingPersonality(true);
    setError(null);
  }

  function startEditProfile() {
    setNameDraft(agent.displayName);
    setPersonalityDraft(agent.instructions ?? "");
    setEditingProfile(true);
    setError(null);
  }

  async function handleProfileSave() {
    const trimmedName = nameDraft.trim();
    const trimmedPersonality = personalityDraft.trim();
    const nameChanged = trimmedName !== agent.displayName.trim();
    const personalityChanged = trimmedPersonality !== (agent.instructions ?? "").trim();
    if (!nameChanged && !personalityChanged) {
      setEditingProfile(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await patchAgent({
        ...(nameChanged ? { displayName: trimmedName } : {}),
        ...(personalityChanged ? { instructions: trimmedPersonality } : {}),
      });
      if (!result) return;
      applyAgentUpdate(result.agent);
      setEditingProfile(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
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
    const runtimeNodeId = placementRuntimeNodeId(placement);
    const node = nodes.find((item) => item.id === runtimeNodeId);
    const ok = await confirm({
      title: t("admin.v2.remove_placement_confirm", {
        node: node?.displayName || placement.nodeDisplayName || runtimeNodeId,
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
  const skills = agent.skills ?? [];
  const isDetail = variant === "detail";

  if (isDetail) {
    /* The profile tab carries only what you can CHANGE about the record —
       portrait, name, role, instructions. Runtime, computer, availability,
       and id are printed once by the RecordBand above every tab, and the
       page header owns the agent's name, so identity here shrinks to one
       portrait + role row above the document. A rail restating the name
       (as the old two-column dossier did) would put the same fact on
       screen twice. */
    return (
      <div className="workspace-profile-panel workspace-profile-dossier agent-dossier">
        <div className="agent-dossier-identity">
          <ProfileImagePicker
            imageUrl={agent.profileImageUrl}
            name={agent.displayName}
            fallback={<IdentityMark kind="agent" />}
            editable={canEditProfile}
            disabled={saving}
            onUpload={handleImageUpload}
            onRemove={handleImageRemove}
          />
          <div className="agent-dossier-identity-meta">
            <div className="workspace-dossier-field">
              <span className="workspace-dossier-field-label" id="agent-default-role-label">
                {t("admin.v2.agent_role_label")}
              </span>
              {/* Role is set at creation and immutable thereafter (birth
                  certificate field) — always render read-only, never editable. */}
              <span className="workspace-dossier-field-value" aria-labelledby="agent-default-role-label">
                {agent.defaultRole
                  ? t(`admin.v2.agent_role.${agent.defaultRole}`, { defaultValue: agent.defaultRole })
                  : t("admin.v2.agent_role_none")}
              </span>
            </div>
            <p className="workspace-dossier-stamp">
              {t("admin.v2.agent_meta_version", { version: agent.version })}
              {" · "}
              {t("admin.v2.agent_meta_created", { time: formatRelativeTime(agent.createdAt, t) })}
              {" · "}
              {t("admin.v2.agent_meta_updated", { time: formatRelativeTime(agent.updatedAt, t) })}
            </p>
          </div>
        </div>

        <div className="workspace-dossier-doc">
          <AgentProfileEditor
            name={agent.displayName}
            nameDraft={nameDraft}
            personality={agent.instructions ?? ""}
            personalityDraft={personalityDraft}
            editing={editingProfile}
            editable={canEditProfile}
            saving={saving}
            onStartEdit={startEditProfile}
            onNameDraftChange={setNameDraft}
            onPersonalityDraftChange={setPersonalityDraft}
            onCancel={() => setEditingProfile(false)}
            onSave={() => void handleProfileSave()}
          />
          {canEditProfile && error ? (
            <p className="adm-form-error" role="alert">{t("admin.v2.action_failed", { message: error })}</p>
          ) : null}
        </div>

        {/* What this agent can actually do on its computer. Node-reported, so
            it is read-only here: installing a skill happens on the machine,
            not in the record. */}
        <div className="adm-drawer-section agent-dossier-skills">
          <p className="workspace-dossier-section-title">{t("agents_page.skills_title")}</p>
          {skills.length === 0 ? (
            <p className="adm-cred-empty">{t("agents_page.skills_empty")}</p>
          ) : (
            <ul className="agent-skill-list">
              {skills.map((skill) => (
                <li key={`${skill.namespace ?? ""}/${skill.name}`} className="agent-skill">
                  <span className="agent-skill-name code" translate="no">
                    {skill.namespace ? `${skill.namespace}/${skill.name}` : skill.name}
                  </span>
                  {skill.description ? (
                    <span className="agent-skill-description">{skill.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Management lives at the foot of the record — it acts on the whole
            agent, not on the identity row or the document. */}
        {canEditProfile ? (
          <div className="workspace-dossier-admin">
            {canManage ? (
              <>
                <div className="adm-drawer-section-actions">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleToggleEnabled()}
                    disabled={saving}
                  >
                    <ActionToggle size={14} aria-hidden="true" />
                    {agent.enabled ? t("admin.v2.agent_disable_action") : t("admin.v2.agent_enable_action")}
                  </Button>
                </div>

                <div className="adm-drawer-section">
                  <p className="workspace-dossier-section-title">{t("admin.v2.agent_placements_title")}</p>
                  {placementDescriptions.length === 0 ? (
                    <p className="adm-cred-empty">{t("admin.v2.no_runtime_placement")}</p>
                  ) : (
                    <PlacementList
                      descriptions={placementDescriptions}
                      canManage
                      pendingPlacementId={pendingPlacementId}
                      onRemove={(placement) => void handleRemovePlacement(placement)}
                      nodeMissingFor={(description) => nodes.length > 0
                        && !nodes.some((node) => node.id === placementRuntimeNodeId(description.placement))}
                    />
                  )}
                </div>
              </>
            ) : null}

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
            <Button variant="default"
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
              <Button variant="default"
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

      <LegacyPersonalityEditor
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

      {canManage ? (
        <div className="adm-drawer-section-actions">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleToggleEnabled()}
            disabled={saving}
          >
            <ActionToggle size={14} aria-hidden="true" />
            {agent.enabled ? t("admin.v2.agent_disable_action") : t("admin.v2.agent_enable_action")}
          </Button>
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
              && !nodes.some((node) => node.id === placementRuntimeNodeId(description.placement))}
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
