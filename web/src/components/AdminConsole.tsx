"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardView } from "./admin/dashboard/DashboardView";
import { useFleetMetrics } from "../hooks/useFleetMetrics";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteControlPanelDaemonNode, deleteControlPanelEmployee, getAuthStatus, getMe, unassignControlPanelDaemonNode } from "../api";
import type {
  AssignControlPanelDaemonNodeResponse,
  ControlPanelDaemonNodeRecord,
  CreateControlPanelEmployeeResponse,
  CurrentUser,
  EmployeeRecord,
} from "../types";
import { AssignNodeDrawer } from "./admin/AssignNodeDrawer";
import { AttentionRail } from "./admin/AttentionRail";
import { BootstrapScreen, LoginScreen } from "./admin/AuthScreens";
import { CredentialsDrawer } from "./admin/CredentialsDrawer";
import { FleetView } from "./admin/FleetView";
import { NavRail, type AdminView } from "./admin/NavRail";
import { OnboardDrawer } from "./admin/OnboardDrawer";
import { PeopleView } from "./admin/PeopleView";
import { PulseStrip } from "./admin/PulseStrip";
import { useAdminFleet } from "../hooks/useAdminFleet";
import {
  readStoredNodeTokens,
  writeStoredNodeToken,
  type StoredNodeTokenMap,
} from "./admin/helpers";

type AuthScreen = "login" | "bootstrap";

export function AdminConsole() {
  const { t } = useTranslation();

  const [admin, setAdmin] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [authScreen, setAuthScreen] = useState<AuthScreen>("login");
  const [authError, setAuthError] = useState<string | null>(null);

  const { nodes, employees, lastUpdated, pollError, isFetching, mergeFleet } = useAdminFleet(Boolean(admin));

  const [view, setView] = useState<AdminView>("dashboard");
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ employeeId?: string } | null>(null);
  const [credentialsNodeId, setCredentialsNodeId] = useState<string | null>(null);
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

  const metrics = useFleetMetrics(nodes, employees);

  const unassignedNodes = useMemo(() => nodes.filter((node) => !node.employeeId), [nodes]);
  const credentialsNode = useMemo(
    () => (credentialsNodeId ? nodes.find((node) => node.id === credentialsNodeId) ?? null : null),
    [credentialsNodeId, nodes],
  );

  function handleRevealCredentials(node: ControlPanelDaemonNodeRecord) {
    setCredentialsNodeId(node.id);
  }

  async function handleUnassignNode(node: ControlPanelDaemonNodeRecord) {
    const result = await unassignControlPanelDaemonNode(node.id);
    mergeFleet((prev) => ({
      ...prev,
      nodes: prev.nodes.map((current) => (current.id === result.node.id ? result.node : current)),
    }));
  }

  async function handleDeleteNode(node: ControlPanelDaemonNodeRecord) {
    await deleteControlPanelDaemonNode(node.id);
    mergeFleet((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((current) => current.id !== node.id),
    }));
    setCredentialsNodeId(null);
  }

  async function handleDeleteEmployee(employee: EmployeeRecord) {
    const result = await deleteControlPanelEmployee(employee.id);
    const unassignedSet = new Set(result.unassignedNodes);
    mergeFleet((prev) => ({
      employees: prev.employees.filter((current) => current.id !== employee.id),
      nodes: prev.nodes.map((current) =>
        unassignedSet.has(current.id) ? (({ employeeId: _ignored, ...rest }) => rest)(current) : current,
      ),
    }));
  }

  function handleOnboardSuccess(result: CreateControlPanelEmployeeResponse) {
    mergeFleet((prev) => ({
      nodes: [result.node, ...prev.nodes.filter((node) => node.id !== result.node.id)],
      employees: [result.employee, ...prev.employees.filter((employee) => employee.id !== result.employee.id)],
    }));

    const nodeToken = result.node.nodeToken;
    if (nodeToken) {
      writeStoredNodeToken(result.node.id, {
        employeeId: result.employee.id,
        nodeToken,
        savedAt: new Date().toISOString(),
      });
      setStoredTokens(readStoredNodeTokens());
    }

    setHighlightedEmployeeId(result.employee.id);
    window.setTimeout(() => setHighlightedEmployeeId((prev) => (prev === result.employee.id ? null : prev)), 2400);

    setOnboardOpen(false);
    setView("people");
    setCredentialsNodeId(result.node.id);
  }

  function handleAssignSuccess(result: AssignControlPanelDaemonNodeResponse) {
    mergeFleet((prev) => ({
      nodes: [result.node, ...prev.nodes.filter((node) => node.id !== result.node.id)],
      employees: [result.employee, ...prev.employees.filter((employee) => employee.id !== result.employee.id)],
    }));
    setHighlightedEmployeeId(result.employee.id);
    window.setTimeout(() => setHighlightedEmployeeId((prev) => (prev === result.employee.id ? null : prev)), 2400);
    setOnboardOpen(false);
    setAssignTarget(null);
    setView("people");
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
  const viewTitle =
    view === "dashboard"
      ? t("admin.v2.title_dashboard")
      : view === "people"
        ? t("admin.v2.title_people")
        : t("admin.v2.title_fleet");
  const viewSub =
    view === "dashboard"
      ? t("admin.v2.sub_dashboard")
      : view === "people"
        ? t("admin.v2.sub_people")
        : t("admin.v2.sub_fleet");

  return (
    <section className="admin-console adm-shell">
      <NavRail view={view} onChange={setView} admin={admin} />

      <div className="adm-main">
        <header className="adm-header">
          <div className="adm-header-text">
            <h1 className="adm-header-title">{viewTitle}</h1>
            <p className="adm-header-sub">{viewSub}</p>
          </div>
          <div className="adm-header-meta">
            <span className={`adm-live-dot ${headerError ? "offline" : isFetching ? "fetching" : ""}`} aria-hidden="true" />
            {headerError ? (
              <span className="adm-header-error">{t("admin.fetch_error", { message: headerError })}</span>
            ) : lastUpdatedStr ? (
              <span className="adm-header-time mono">{t("admin.updated_at", { time: lastUpdatedStr })}</span>
            ) : null}
            <Button type="button" onClick={() => setOnboardOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              <span>{t("admin.v2.onboard_cta")}</span>
            </Button>
          </div>
        </header>

        <PulseStrip
          nodes={metrics.total}
          employees={metrics.employeeTotal}
          ready={metrics.ready}
          running={metrics.running}
          failed={metrics.failed}
          queued={metrics.queued}
        />

        <div className="adm-content">
          <div className="adm-content-main">
            {view === "dashboard" ? (
              <DashboardView nodes={nodes} employees={employees} metrics={metrics} />
            ) : view === "people" ? (
              <PeopleView
                employees={employees}
                nodes={nodes}
                onRevealCredentials={handleRevealCredentials}
                onOnboard={() => setOnboardOpen(true)}
                onRequestAssign={(employeeId) => setAssignTarget({ employeeId })}
                onDeleteEmployee={handleDeleteEmployee}
                unassignedNodeCount={unassignedNodes.length}
                highlightedEmployeeId={highlightedEmployeeId}
              />
            ) : (
              <FleetView
                nodes={nodes}
                employees={employees}
                onRevealCredentials={handleRevealCredentials}
                onDeleteNode={handleDeleteNode}
              />
            )}
          </div>
          {view === "fleet" ? <AttentionRail nodes={nodes} /> : null}
        </div>
      </div>

      <OnboardDrawer
        open={onboardOpen}
        onClose={() => setOnboardOpen(false)}
        employees={employees}
        unassignedNodes={unassignedNodes}
        onSuccess={handleOnboardSuccess}
        onAssignSuccess={handleAssignSuccess}
      />
      <AssignNodeDrawer
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        employees={employees}
        unassignedNodes={unassignedNodes}
        defaultEmployeeId={assignTarget?.employeeId}
        onAssignSuccess={handleAssignSuccess}
      />
      <CredentialsDrawer
        open={credentialsNodeId !== null}
        onClose={() => setCredentialsNodeId(null)}
        node={credentialsNode}
        storedToken={credentialsNodeId ? storedTokens[credentialsNodeId] : undefined}
        onUnassign={handleUnassignNode}
        onDelete={handleDeleteNode}
      />
    </section>
  );
}
