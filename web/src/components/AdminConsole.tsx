"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import {
  getAuthStatus,
  getMe,
  listControlPanelDaemonNodes,
  listControlPanelEmployees,
} from "../api";
import type {
  AssignControlPanelDaemonNodeResponse,
  ControlPanelDaemonNodeRecord,
  CreateControlPanelEmployeeResponse,
  CurrentUser,
  EmployeeRecord,
} from "../types";
import { AttentionRail } from "./admin/AttentionRail";
import { BootstrapScreen, LoginScreen } from "./admin/AuthScreens";
import { CredentialsDrawer } from "./admin/CredentialsDrawer";
import { FleetView } from "./admin/FleetView";
import { NavRail, type AdminView } from "./admin/NavRail";
import { OnboardDrawer } from "./admin/OnboardDrawer";
import { PeopleView } from "./admin/PeopleView";
import { PulseStrip } from "./admin/PulseStrip";
import {
  isStale,
  readStoredNodeTokens,
  visualStatus,
  writeStoredNodeToken,
  type StoredNodeTokenMap,
} from "./admin/helpers";

type AuthScreen = "login" | "bootstrap";

export function AdminConsole() {
  const { t } = useTranslation();

  const [nodes, setNodes] = useState<ControlPanelDaemonNodeRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const [admin, setAdmin] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [authScreen, setAuthScreen] = useState<AuthScreen>("login");

  const [view, setView] = useState<AdminView>("people");
  const [onboardOpen, setOnboardOpen] = useState(false);
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
      if (status === 503) setFetchError(t("admin.admin_token_required"));
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

  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();

    async function poll() {
      setIsFetching(true);
      try {
        const [nodeResult, employeeResult] = await Promise.all([
          listControlPanelDaemonNodes(controller.signal),
          listControlPanelEmployees(controller.signal),
        ]);
        setNodes(nodeResult.nodes);
        setEmployees(employeeResult.employees);
        setLastUpdated(new Date());
        setFetchError(null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        setFetchError(message);
        if (message.includes("401") || message.includes("Session expired") || message.includes("Admin token is required")) {
          setAdmin(null);
        }
      } finally {
        setIsFetching(false);
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [admin]);

  const metrics = useMemo(() => {
    const total = nodes.length;
    const ready = nodes.filter((node) => visualStatus(node) === "ready").length;
    const running = nodes.filter((node) => !isStale(node) && node.status === "running").length;
    const failed = nodes.filter((node) => {
      const status = visualStatus(node);
      return status === "failed" || status === "stale";
    }).length;
    const queued = nodes.reduce((acc, node) => acc + node.queuedCommandCount, 0);
    const employeeTotal = employees.length || new Set(nodes.map((node) => node.employeeId).filter(Boolean)).size;
    return { total, ready, running, failed, queued, employeeTotal };
  }, [nodes, employees]);

  const unassignedNodes = useMemo(() => nodes.filter((node) => !node.employeeId), [nodes]);
  const credentialsNode = useMemo(
    () => (credentialsNodeId ? nodes.find((node) => node.id === credentialsNodeId) ?? null : null),
    [credentialsNodeId, nodes],
  );

  function handleRevealCredentials(node: ControlPanelDaemonNodeRecord) {
    setCredentialsNodeId(node.id);
  }

  function handleOnboardSuccess(result: CreateControlPanelEmployeeResponse) {
    setNodes((current) => [result.node, ...current.filter((node) => node.id !== result.node.id)]);
    setEmployees((current) => [result.employee, ...current.filter((employee) => employee.id !== result.employee.id)]);
    setLastUpdated(new Date());

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
    setNodes((current) => [result.node, ...current.filter((node) => node.id !== result.node.id)]);
    setEmployees((current) => [result.employee, ...current.filter((employee) => employee.id !== result.employee.id)]);
    setLastUpdated(new Date());
    setHighlightedEmployeeId(result.employee.id);
    window.setTimeout(() => setHighlightedEmployeeId((prev) => (prev === result.employee.id ? null : prev)), 2400);
    setOnboardOpen(false);
    setView("people");
    setCredentialsNodeId(result.node.id);
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

  const lastUpdatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const viewTitle = view === "people" ? t("admin.v2.title_people") : t("admin.v2.title_fleet");
  const viewSub = view === "people" ? t("admin.v2.sub_people") : t("admin.v2.sub_fleet");

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
            <span className={`adm-live-dot ${fetchError ? "offline" : isFetching ? "fetching" : ""}`} aria-hidden="true" />
            {fetchError ? (
              <span className="adm-header-error">{fetchError}</span>
            ) : lastUpdatedStr ? (
              <span className="adm-header-time mono">{t("admin.updated_at", { time: lastUpdatedStr })}</span>
            ) : null}
            <button
              type="button"
              className="adm-button-primary"
              onClick={() => setOnboardOpen(true)}
            >
              <Plus size={16} aria-hidden="true" />
              <span>{t("admin.v2.onboard_cta")}</span>
            </button>
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
            {view === "people" ? (
              <PeopleView
                employees={employees}
                nodes={nodes}
                onRevealCredentials={handleRevealCredentials}
                onOnboard={() => setOnboardOpen(true)}
                highlightedEmployeeId={highlightedEmployeeId}
              />
            ) : (
              <FleetView
                nodes={nodes}
                employees={employees}
                onRevealCredentials={handleRevealCredentials}
              />
            )}
          </div>
          <AttentionRail nodes={nodes} />
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
      <CredentialsDrawer
        open={credentialsNodeId !== null}
        onClose={() => setCredentialsNodeId(null)}
        node={credentialsNode}
        storedToken={credentialsNodeId ? storedTokens[credentialsNodeId] : undefined}
      />
    </section>
  );
}
