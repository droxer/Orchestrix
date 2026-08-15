"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAgent, listSandboxes } from "../../api";
import {
  computersForEmployee,
  computerName,
  runtimesForComputer,
  type ComputerOwnership,
  type NodeLike,
} from "../../lib/createAgent";
import { EMPLOYEE_AGENTS_QUERY_KEY } from "../../hooks/useEmployeeAgents";
import { agentLabel } from "../../lib/plan";
import { AGENT_NAMES, AGENT_ROLE_OPTIONS } from "../../types";
import type { AgentName, AgentRole, EmployeeAgent, SandboxRecord } from "../../types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Drawer } from "@/components/ui/Drawer";
import { OWNERSHIP_ICON } from "../AgentPlacementBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

interface CreateAgentDialogProps {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  /** Fires once the agent exists on the backend, so the caller can select it right away. */
  onCreated: (agent: EmployeeAgent) => void;
}

/** GET /sandboxes carries workspaceId (the host machine id) alongside the
 *  fields relay-core's SandboxRecord already types — see
 *  core/computer_identity.py's computer_id() on the backend. */
type SandboxWithWorkspace = SandboxRecord & { workspaceId?: string };

function ComputerOptionLabel({
  kindLabel,
  label,
  ownership,
}: {
  kindLabel: string;
  label: string;
  ownership: ComputerOwnership;
}) {
  const ComputerIcon = OWNERSHIP_ICON[ownership];
  return (
    <span className="create-agent-computer-option">
      <ComputerIcon size={14} aria-hidden="true" />
      <span className="create-agent-computer-name" translate="no">{label}</span>
      <span className="create-agent-computer-kind">{kindLabel}</span>
    </span>
  );
}

/** Maps a daemon node onto the identity shape createAgent.ts operates on.
 *  `sandbox.agents` is a status-dict keyed by every possible runtime kind
 *  (ready/failed/unknown), not a list of what's installed, so only
 *  `status === "ready"` entries are surfaced as supportedAgents. */
function toNodeLike(sandbox: SandboxWithWorkspace): NodeLike {
  const readyRuntimes = Object.entries(sandbox.agents ?? {})
    .filter(([, status]) => status === "ready")
    .map(([kind]) => kind);
  return {
    id: sandbox.id,
    employeeId: sandbox.employeeId,
    workspaceId: sandbox.workspaceId,
    managedNodeId: sandbox.managedNodeId,
    supportedAgents: readyRuntimes,
    disabledAgents: sandbox.disabledAgents,
  };
}

/**
 * Explicit agent creation: computer -> runtime -> role. Mirrors the shape of
 * ConnectComputerDrawer / ManageExecutorsDrawer rather than inventing a new
 * form pattern. POST /agents is the only write; the computer/runtime
 * options come from the employee-scoped GET /sandboxes already used
 * elsewhere in the app.
 */
export function CreateAgentDialog({ open, onClose, employeeId, onCreated }: CreateAgentDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const computerLabelId = useId();
  const runtimeLabelId = useId();
  const roleLabelId = useId();

  const sandboxesQuery = useQuery({
    queryKey: ["create-agent", "sandboxes"],
    queryFn: ({ signal }: { signal: AbortSignal }) => listSandboxes(undefined, signal),
    enabled: open,
  });
  const sandboxes = useMemo(
    () => (sandboxesQuery.data?.sandboxes ?? []) as SandboxWithWorkspace[],
    [sandboxesQuery.data],
  );
  const nodeLikes = useMemo(() => sandboxes.map(toNodeLike), [sandboxes]);

  const computerOptions = useMemo(() => {
    return computersForEmployee(nodeLikes, employeeId).map((group) => {
      const primary = sandboxes.find((sandbox) => group.nodes.some((node) => node.id === sandbox.id));
      return {
        computerId: group.computerId,
        ownership: group.ownership,
        label: primary ? computerName(primary) : group.computerId,
      };
    });
  }, [nodeLikes, sandboxes, employeeId]);

  const [computerId, setComputerId] = useState("");
  const [executorKind, setExecutorKind] = useState<AgentName | "">("");
  const [defaultRole, setDefaultRole] = useState<AgentRole | "">("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const runtimeOptions = useMemo(
    (): AgentName[] =>
      computerId
        ? runtimesForComputer(nodeLikes, computerId).filter((kind): kind is AgentName =>
            AGENT_NAMES.includes(kind as AgentName),
          )
        : [],
    [nodeLikes, computerId],
  );

  useEffect(() => {
    if (open) {
      setComputerId("");
      setExecutorKind("");
      setDefaultRole("");
      setDisplayName("");
      setError(null);
      setFieldError(null);
      setIsBusy(false);
    }
  }, [open]);

  // The runtime picked for a previous computer may not exist on the newly
  // selected one — drop it rather than silently submitting a stale pick.
  useEffect(() => {
    if (executorKind && !runtimeOptions.includes(executorKind)) {
      setExecutorKind("");
    }
  }, [runtimeOptions, executorKind]);

  const hasUnsavedChanges = Boolean(
    computerId || executorKind || defaultRole || displayName.trim(),
  );
  const confirmDiscardChanges = useUnsavedChangesGuard(open && hasUnsavedChanges && !isBusy);

  async function requestClose() {
    if (isBusy) return;
    if (await confirmDiscardChanges()) onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!computerId) {
      setFieldError(t("agents_page.create_computer_required"));
      return;
    }
    if (!executorKind) {
      setFieldError(t("agents_page.create_runtime_required"));
      return;
    }
    if (!defaultRole) {
      setFieldError(t("agents_page.create_role_required"));
      return;
    }
    setFieldError(null);
    setError(null);
    setIsBusy(true);
    try {
      const result = await createAgent({
        computerId,
        executorKind,
        defaultRole,
        displayName: displayName.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: [EMPLOYEE_AGENTS_QUERY_KEY] });
      onCreated(result.agent);
      onClose();
    } catch (err) {
      setError(t("agents_page.create_error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={() => { void requestClose(); }}
      kicker={t("agents_page.title")}
      title={t("agents_page.create_title")}
      subtitle={t("agents_page.create_sub")}
      width="form"
      closeLabel={t("admin.v2.close_drawer")}
      bodyClassName="adm-drawer-body--column"
    >
      <form className="adm-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <fieldset className="adm-form-section">
          <Field
            label={t("agents_page.create_computer_label")}
            labelId={computerLabelId}
            wrapper="div"
          >
            <Select
              value={computerId || null}
              onValueChange={(value) => setComputerId(value ?? "")}
              disabled={isBusy || sandboxesQuery.isLoading || computerOptions.length === 0}
            >
              <SelectTrigger
                data-modal-initial-focus
                className="w-full"
                aria-labelledby={computerLabelId}
              >
                <SelectValue placeholder={t("agents_page.create_computer_placeholder")}>
                  {(value: string | null) => {
                    const selected = computerOptions.find((option) => option.computerId === value);
                    if (!selected) return t("agents_page.create_computer_placeholder");
                    return (
                      <ComputerOptionLabel
                        kindLabel={t(`admin.v2.node_ownership_${selected.ownership}`)}
                        label={selected.label}
                        ownership={selected.ownership}
                      />
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {computerOptions.map((option) => (
                  <SelectItem key={option.computerId} value={option.computerId}>
                    <ComputerOptionLabel
                      kindLabel={t(`admin.v2.node_ownership_${option.ownership}`)}
                      label={option.label}
                      ownership={option.ownership}
                    />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!sandboxesQuery.isLoading && computerOptions.length === 0 ? (
              <p className="adm-form-hint">{t("agents_page.create_computer_empty")}</p>
            ) : null}
          </Field>

          <Field
            label={t("agents_page.create_runtime_label")}
            labelId={runtimeLabelId}
            wrapper="div"
          >
            <Select
              value={executorKind || null}
              onValueChange={(value) => setExecutorKind((value ?? "") as AgentName)}
              disabled={isBusy || !computerId || runtimeOptions.length === 0}
            >
              <SelectTrigger className="w-full" aria-labelledby={runtimeLabelId}>
                <SelectValue placeholder={t("agents_page.create_runtime_placeholder")}>
                  {(value: string | null) =>
                    value ? agentLabel(value as AgentName) : t("agents_page.create_runtime_placeholder")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {runtimeOptions.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    <span translate="no">{agentLabel(kind)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {computerId && runtimeOptions.length === 0 ? (
              <p className="adm-form-hint">{t("agents_page.create_runtime_empty")}</p>
            ) : null}
          </Field>

          <Field
            label={t("admin.v2.agent_role_label")}
            labelId={roleLabelId}
            wrapper="div"
          >
            <Select
              value={defaultRole || null}
              onValueChange={(value) => setDefaultRole((value ?? "") as AgentRole)}
              disabled={isBusy}
            >
              <SelectTrigger className="w-full" aria-labelledby={roleLabelId}>
                <SelectValue placeholder={t("agents_page.create_role_placeholder")}>
                  {(value: string | null) => value
                    ? t(`admin.v2.agent_role.${value}`, { defaultValue: value })
                    : t("agents_page.create_role_placeholder")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {AGENT_ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`admin.v2.agent_role.${role}`, { defaultValue: role })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("agents_page.create_name_label")} optional={t("admin.v2.optional")}>
            <Input
              name="create-agent-display-name"
              autoComplete="off"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t("agents_page.create_name_placeholder")}
              maxLength={64}
              disabled={isBusy}
            />
          </Field>
        </fieldset>

        {fieldError ? <div className="adm-form-error" role="alert">{fieldError}</div> : null}
        {error ? <div className="adm-form-error" role="alert">{error}</div> : null}

        <div className="adm-form-actions">
          <Button size="cta" type="button" variant="ghost" onClick={() => { void requestClose(); }} disabled={isBusy}>
            {t("admin.v2.cancel")}
          </Button>
          <Button size="cta" type="submit" loading={isBusy}>
            {isBusy ? t("agents_page.create_creating") : t("agents_page.create_submit")}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
