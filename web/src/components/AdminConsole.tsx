"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardView } from "./admin/dashboard/DashboardView";
import { useFleetMetrics } from "../hooks/useFleetMetrics";
import { useTranslation } from "react-i18next";
import { useMutationError } from "../hooks/useMutationError";
import { Server, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavRefresh } from "./icons";
import { deleteControlPanelDaemonNode, deleteControlPanelEmployee, getAuthStatus, getMe, unassignControlPanelDaemonNode } from "../api";
import type {
  AssignControlPanelDaemonNodeResponse,
  ControlPanelDaemonNodeRecord,
  CreateControlPanelDaemonNodeResponse,
  CreateControlPanelEmployeeResponse,
  CurrentUser,
  EmployeeRecord,
} from "../types";
import { AssignNodeDrawer } from "./admin/AssignNodeDrawer";
import { AttentionRail } from "./admin/AttentionRail";
import { BootstrapScreen, LoginScreen } from "./admin/AuthScreens";
import { CredentialsDrawer } from "./admin/CredentialsDrawer";
import { FleetView } from "./admin/FleetView";
import { ManageAgentsDrawer } from "./admin/ManageAgentsDrawer";
import { PageHeader } from "./PageHeader";
import { AdminViewToggle, type AdminView } from "./admin/AdminViewToggle";
import { AddEmployeeDrawer } from "./admin/AddEmployeeDrawer";
import { AddNodeDrawer } from "./admin/AddNodeDrawer";
import { PeopleView } from "./admin/PeopleView";
import { PulseStrip } from "./admin/PulseStrip";
import { useAdminFleet } from "../hooks/useAdminFleet";
import { useRelayStore } from "../lib/store";
import {
  persistStoredNodeTokenMap,
  readStoredNodeTokens,
  upsertStoredCredentialsFromNodes,
  writeStoredNodeToken,
  type StoredNodeTokenMap,
} from "./admin/helpers";

type AuthScreen = "login" | "bootstrap";

export function AdminConsole({ currentUser }: { currentUser?: CurrentUser | null }) {
  const { t } = useTranslation();
  const { reportMutationError } = useMutationError();

  // App only mounts this component for an authenticated admin, so seed the auth
  // state from the session it already holds. This skips the redundant /auth/me
  // probe on mount that would otherwise flash the admin login/loading card
  // before resolving.
  const seededAdmin = currentUser?.role === "admin" ? currentUser : null;
  const [admin, setAdmin] = useState<CurrentUser | null>(seededAdmin);
  const [authChecked, setAuthChecked] = useState(seededAdmin !== null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [authScreen, setAuthScreen] = useState<AuthScreen>("login");
  const [authError, setAuthError] = useState<string | null>(null);

  const { nodes, employees, lastUpdated, pollError, isFetching, mergeFleet, refetch } = useAdminFleet(Boolean(admin));

  const [view, setView] = useState<AdminView>("dashboard");
  const setAdminView = useRelayStore((state) => state.setAdminView);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ employeeId?: string } | null>(null);
  const [credentialsNodeId, setCredentialsNodeId] = useState<string | null>(null);
  const [manageAgentsNodeId, setManageAgentsNodeId] = useState<string | null>(null);
  const [highlightedEmployeeId, setHighlightedEmployeeId] = useState<string | null>(null);
  const [storedTokens, setStoredTokens] = useState<StoredNodeTokenMap>(() => readStoredNodeTokens());

  async function checkAuth(signal?: AbortSignal) {
    try {
      const statusResult = await getAuthStatus(signal);
      setNeedsBootstrap(statusResult.requiresBootstrap);
      setAuthScreen(statusResult.requiresBootstrap ? "bootstrap" : "login");
    } catch {
      setNeedsBootstrap(false);
    }
    try {
      const result = await getMe(signal);
      if (result.authenticated && result.user?.role === "admin") {
        setAdmin(result.user);
      } else {
        setAdmin(null);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const status = err && typeof err === "object" && "status" in err ? (err as { status: number }).status : 0;
      setAdmin(null);
      if (status === 503) setAuthError(t("admin.admin_token_required"));
    } finally {
      setAuthChecked(true);
    }
  }

  useEffect(() => {
    // Already authenticated via the app session — no probe needed on mount.
    if (seededAdmin) return;
    const controller = new AbortController();
    void checkAuth(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The fleet poll lives in useAdminFleet; a failure that looks like an expired
  // session drops us back to the login screen (the query disables once admin
  // clears).
  useEffect(() => {
    if (pollError && (pollError.includes("401") || pollError.includes("Session expired") || pollError.includes("Admin token is required"))) {
      setAdmin(null);
    }
  }, [pollError]);

  useEffect(() => {
    setAdminView(view);
  }, [setAdminView, view]);

  const metrics = useFleetMetrics(nodes, employees);

  const unassignedNodes = useMemo(() => nodes.filter((node) => !node.employeeId), [nodes]);
  const credentialsNode = useMemo(
    () => (credentialsNodeId ? nodes.find((node) => node.id === credentialsNodeId) ?? null : null),
    [credentialsNodeId, nodes],
  );
  const manageAgentsNode = useMemo(
    () => (manageAgentsNodeId ? nodes.find((node) => node.id === manageAgentsNodeId) ?? null : null),
    [manageAgentsNodeId, nodes],
  );

  useEffect(() => {
    setStoredTokens((current) => {
      const updated = upsertStoredCredentialsFromNodes(current, nodes);
      if (!updated) return current;
      persistStoredNodeTokenMap(updated);
      return updated;
    });
  }, [nodes]);

  function handleRevealCredentials(node: ControlPanelDaemonNodeRecord) {
    setCredentialsNodeId(node.id);
  }

  function handleManageAgents(node: ControlPanelDaemonNodeRecord) {
    setManageAgentsNodeId(node.id);
  }

  function handleNodeUpdated(updated: ControlPanelDaemonNodeRecord) {
    mergeFleet((prev) => ({
      ...prev,
      nodes: prev.nodes.map((current) => (current.id === updated.id ? updated : current)),
    }));
  }

  async function handleUnassignNode(node: ControlPanelDaemonNodeRecord) {
    try {
      const result = await unassignControlPanelDaemonNode(node.id);
      mergeFleet((prev) => ({
        ...prev,
        nodes: prev.nodes.map((current) => (current.id === result.node.id ? result.node : current)),
      }));
    } catch (error) {
      reportMutationError("Failed to unassign node", error, t("errors.admin_unassign_node"));
      throw error;
    }
  }

  async function handleDeleteNode(node: ControlPanelDaemonNodeRecord) {
    try {
      await deleteControlPanelDaemonNode(node.id);
      mergeFleet((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((current) => current.id !== node.id),
      }));
      setCredentialsNodeId(null);
    } catch (error) {
      reportMutationError("Failed to delete node", error, t("errors.admin_delete_node"));
      throw error;
    }
  }

  async function handleDeleteEmployee(employee: EmployeeRecord) {
    try {
      const result = await deleteControlPanelEmployee(employee.id);
      const unassignedSet = new Set(result.unassignedNodes);
      mergeFleet((prev) => ({
        employees: prev.employees.filter((current) => current.id !== employee.id),
        nodes: prev.nodes.map((current) =>
          unassignedSet.has(current.id) ? (({ employeeId: _ignored, ...rest }) => rest)(current) : current,
        ),
      }));
    } catch (error) {
      reportMutationError("Failed to delete employee", error, t("errors.admin_delete_employee"));
      throw error;
    }
  }

  function handleAddEmployeeSuccess(result: CreateControlPanelEmployeeResponse) {
    const { node } = result;
    mergeFleet((prev) => ({
      nodes: node ? [node, ...prev.nodes.filter((current) => current.id !== node.id)] : prev.nodes,
      employees: [result.employee, ...prev.employees.filter((employee) => employee.id !== result.employee.id)],
    }));

    if (node?.nodeToken) {
      writeStoredNodeToken(node.id, {
        employeeId: result.employee.id,
        nodeToken: node.nodeToken,
        savedAt: new Date().toISOString(),
      });
      setStoredTokens(readStoredNodeTokens());
    }

    setHighlightedEmployeeId(result.employee.id);
    window.setTimeout(() => setHighlightedEmployeeId((prev) => (prev === result.employee.id ? null : prev)), 2400);

    setAddEmployeeOpen(false);
    setView("people");
    // Only surface the credentials drawer when a sandbox was bound — it is
    // keyed by node id and has nothing to show for an unassigned employee.
    if (node) setCredentialsNodeId(node.id);
  }

  function handleAssignSuccess(result: AssignControlPanelDaemonNodeResponse) {
    mergeFleet((prev) => ({
      nodes: [result.node, ...prev.nodes.filter((node) => node.id !== result.node.id)],
      employees: [result.employee, ...prev.employees.filter((employee) => employee.id !== result.employee.id)],
    }));
    setHighlightedEmployeeId(result.employee.id);
    window.setTimeout(() => setHighlightedEmployeeId((prev) => (prev === result.employee.id ? null : prev)), 2400);
    setAssignTarget(null);
    setView("people");
  }

  function handleCreateNodeSuccess(result: CreateControlPanelDaemonNodeResponse) {
    const { node } = result;
    mergeFleet((prev) => ({
      ...prev,
      nodes: [node, ...prev.nodes.filter((current) => current.id !== node.id)],
    }));

    writeStoredNodeToken(node.id, {
      employeeId: node.employeeId,
      sandboxToken: result.sandboxToken,
      nodeToken: result.nodeToken,
      daemonCommand: result.daemonCommand,
      savedAt: new Date().toISOString(),
    });
    setStoredTokens(readStoredNodeTokens());
    setHighlightedEmployeeId(node.employeeId ?? null);
    window.setTimeout(() => setHighlightedEmployeeId((prev) => (prev === node.employeeId ? null : prev)), 2400);
    setAddNodeOpen(false);
    setAssignTarget(null);
    setView("fleet");
    setCredentialsNodeId(node.id);
  }

  if (!authChecked) {
    return (
      <section className="admin-console adm-bare">
        <div className="adm-loading">{t("admin.loading")}</div>
      </section>
    );
  }

  if (!admin) {
    return (
      <section className="admin-console adm-bare">
        {authScreen === "bootstrap" || needsBootstrap ? (
          <BootstrapScreen onBootstrapped={() => void checkAuth()} onSwitchToLogin={() => setAuthScreen("login")} />
        ) : (
          <LoginScreen
            onLogin={() => void checkAuth()}
            needsBootstrap={needsBootstrap}
            onSwitchToBootstrap={() => setAuthScreen("bootstrap")}
          />
        )}
      </section>
    );
  }

  const headerError = authError ?? pollError;
  const lastUpdatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const viewTitle = t(`admin.v2.title_${view}`);
  const viewSubtitle = t(`admin.v2.sub_${view}`);

  return (
    <section
      id="admin-panel"
      className="admin-console adm-shell"
      data-density="compact"
      data-admin-view={view}
      aria-label={viewTitle}
      tabIndex={-1}
    >
      <PageHeader
        kicker={t("nav.admin")}
        title={viewTitle}
        subtitle={viewSubtitle}
        titleVariant="display"
        layout="stacked"
        toolbar={<AdminViewToggle view={view} onChange={setView} />}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("nav.refresh")}
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <NavRefresh size={16} className={isFetching ? "spin" : undefined} />
            </Button>
            <span
              className="adm-command-status flex items-center gap-xs text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span
                className={`adm-live-dot ${headerError ? "offline" : isFetching ? "fetching" : ""}`}
                aria-hidden="true"
              />
              {headerError ? (
                <span className="adm-command-status-text text-danger">
                  {t("admin.fetch_error", { message: headerError })}
                </span>
              ) : lastUpdatedStr ? (
                <span className="adm-command-status-text mono">
                  {t("admin.updated_at", { time: lastUpdatedStr })}
                </span>
              ) : null}
            </span>
            {view !== "fleet" ? (
              <Button
                type="button"
                className="adm-command-onboard"
                onClick={() => setAddEmployeeOpen(true)}
                aria-label={t("admin.v2.add_employee_cta")}
              >
                <UserPlus size={16} aria-hidden="true" />
                <span className="adm-command-onboard-label">{t("admin.v2.add_employee_cta")}</span>
              </Button>
            ) : null}
            {view !== "people" ? (
              <Button
                type="button"
                variant={view === "fleet" ? "default" : "outline"}
                className="adm-command-onboard"
                onClick={() => setAddNodeOpen(true)}
                aria-label={t("admin.v2.add_node_cta")}
              >
                <Server size={16} aria-hidden="true" />
                <span className="adm-command-onboard-label">{t("admin.v2.add_node_cta")}</span>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="adm-main">
        <PulseStrip
          view={view}
          running={metrics.running}
          failed={metrics.failed}
          queued={metrics.queued}
          unassignedNodes={unassignedNodes.length}
        />

        <div className={`adm-content${view === "fleet" ? "" : " adm-content--solo"}`}>
          <div className="adm-content-main">
            <div key={view} className="adm-view-stage">
              {view === "dashboard" ? (
                <DashboardView nodes={nodes} employees={employees} metrics={metrics} />
              ) : view === "people" ? (
                <PeopleView
                  employees={employees}
                  nodes={nodes}
                  onRevealCredentials={handleRevealCredentials}
                  onAddEmployee={() => setAddEmployeeOpen(true)}
                  onRequestAssign={(employeeId) => setAssignTarget({ employeeId })}
                  onDeleteEmployee={handleDeleteEmployee}
                  unassignedNodeCount={unassignedNodes.length}
                  highlightedEmployeeId={highlightedEmployeeId}
                />
              ) : (
                <FleetView
                  nodes={nodes}
                  employees={employees}
                  storedTokens={storedTokens}
                  onRevealCredentials={handleRevealCredentials}
                  onManageAgents={handleManageAgents}
                  onDeleteNode={handleDeleteNode}
                  onAddNode={() => setAddNodeOpen(true)}
                />
              )}
            </div>
          </div>
          {view === "fleet" ? <AttentionRail nodes={nodes} /> : null}
        </div>
      </div>

      <AddEmployeeDrawer
        open={addEmployeeOpen}
        onClose={() => setAddEmployeeOpen(false)}
        unassignedNodes={unassignedNodes}
        onSuccess={handleAddEmployeeSuccess}
      />
      <AddNodeDrawer
        open={addNodeOpen}
        onClose={() => setAddNodeOpen(false)}
        employees={employees}
        onSuccess={handleCreateNodeSuccess}
      />
      <AssignNodeDrawer
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        employees={employees}
        unassignedNodes={unassignedNodes}
        defaultEmployeeId={assignTarget?.employeeId}
        onAssignSuccess={handleAssignSuccess}
        onCreateNodeSuccess={handleCreateNodeSuccess}
      />
      <CredentialsDrawer
        open={credentialsNodeId !== null}
        onClose={() => setCredentialsNodeId(null)}
        node={credentialsNode}
        storedToken={credentialsNodeId ? storedTokens[credentialsNodeId] : undefined}
        onUnassign={handleUnassignNode}
        onDelete={handleDeleteNode}
      />
      <ManageAgentsDrawer
        open={manageAgentsNodeId !== null}
        onClose={() => setManageAgentsNodeId(null)}
        node={manageAgentsNode}
        onUpdated={handleNodeUpdated}
      />
    </section>
  );
}
