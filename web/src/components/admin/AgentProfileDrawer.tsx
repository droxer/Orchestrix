"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getControlPanelAgent } from "../../api";
import { agentLabel } from "../../lib/plan";
import type { ControlPanelDaemonNodeRecord, EmployeeAgent, EmployeeRecord } from "../../types";
import { IdentityMonogram } from "../IdentityMonogram";
import { AgentProfilePanel } from "../AgentProfilePanel";
import { ProfileImage } from "../ProfileImagePicker";
import { Drawer } from "../ui/Drawer";

interface AgentProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  agentId: string | null;
  /** Pre-loaded agent data (e.g. from the employee's own agent list). When
   *  provided, skips the admin-only `/api/v1/admin/agents/{id}` fetch entirely — needed
   *  because non-admin employees can't call that route. */
  agent?: EmployeeAgent | null;
  employees?: EmployeeRecord[];
  nodes?: ControlPanelDaemonNodeRecord[];
  /** Hides rename/enable-disable/delete/remove-placement actions. Defaults to
   *  true (admin page usage). */
  canManage?: boolean;
  /** Allows the owning employee to edit display name and instructions on the
   *  agents page without full admin privileges. */
  canEditMeta?: boolean;
  onAgentUpdated?: (agent: EmployeeAgent) => void;
  onAgentDeleted?: (agentId: string) => void;
  /** Opens the agent's dedicated workspace/artifacts page, if the caller supports it. */
  onOpenWorkspace?: (agent: EmployeeAgent) => void;
}

export function AgentProfileDrawer({
  open,
  onClose,
  agentId,
  agent: presetAgent,
  employees = [],
  nodes = [],
  canManage = true,
  canEditMeta = false,
  onAgentUpdated,
  onAgentDeleted,
  onOpenWorkspace,
}: AgentProfileDrawerProps) {
  const { t } = useTranslation();

  const agentQuery = useQuery({
    queryKey: ["admin", "agent", agentId] as const,
    queryFn: ({ signal }) => getControlPanelAgent(agentId as string, signal),
    enabled: open && agentId !== null && !presetAgent,
  });
  const agent = presetAgent ?? agentQuery.data?.agent ?? null;

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

  const executorLabel = agentLabel(agent.executorKind);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="adm-drawer-title-row">
          <ProfileImage
            src={agent.profileImageUrl}
            alt=""
            fallback={<IdentityMonogram name={agent.displayName} size={11} />}
            className="adm-drawer-title-profile-image"
          />
          <span translate="no">{agent.displayName}</span>
        </span>
      }
      subtitle={
        <span className="adm-drawer-sub-role" translate="no">
          {executorLabel}
        </span>
      }
      closeLabel={t("admin.v2.close_drawer")}
      ariaLabel={agent.displayName}
      layer={1}
      width={520}
      bodyClassName="adm-drawer-body--agent-profile"
    >
      <AgentProfilePanel
        agent={agent}
        employees={employees}
        nodes={nodes}
        canManage={canManage}
        canEditMeta={canEditMeta}
        variant="workspace"
        embedInDrawer
        onAgentUpdated={onAgentUpdated}
        onAgentDeleted={(deletedId) => {
          onAgentDeleted?.(deletedId);
          onClose();
        }}
        onOpenWorkspace={onOpenWorkspace}
      />
    </Drawer>
  );
}
