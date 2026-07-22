import type { AppRoute, MobileView } from "./viewTypes.js";

const WORK_ROUTES = new Set<AppRoute>(["backlog", "routine", "agents", "teams", "channels", "admin"]);

export type AppHashState = {
  route: AppRoute;
  mobileView: MobileView;
  sessionId: string | null;
  agentWorkspaceId?: string | null;
};

function normalizeHash(hash: string): string {
  if (!hash || hash === "#") return "#/chat";
  return hash.startsWith("#") ? hash : `#${hash}`;
}

function hashSegments(hash: string): string[] {
  const normalized = normalizeHash(hash).slice(1);
  const withoutQuery = normalized.split("?")[0] ?? "";
  return withoutQuery
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

export function parseAppHash(hash: string): AppHashState {
  const [head, second, third] = hashSegments(hash);
  if (head === "agents" && second && third === "workspace") {
    return { route: "agents", mobileView: "chat", sessionId: null, agentWorkspaceId: second };
  }
  if (head && WORK_ROUTES.has(head as AppRoute)) {
    return { route: head as AppRoute, mobileView: "chat", sessionId: null };
  }
  if (head === "threads") return { route: "main", mobileView: "threads", sessionId: null };
  if (head === "chat") return { route: "main", mobileView: "chat", sessionId: second ?? null };
  return { route: "main", mobileView: "chat", sessionId: null };
}

export function hashForAppState({ route, mobileView, sessionId, agentWorkspaceId }: AppHashState): string {
  if (route === "agents" && agentWorkspaceId) return `#/agents/${encodeURIComponent(agentWorkspaceId)}/workspace`;
  if (route !== "main") return `#/${route}`;
  if (mobileView === "threads") return "#/threads";
  return sessionId ? `#/chat/${encodeURIComponent(sessionId)}` : "#/chat";
}

export function hrefForRoute(route: AppRoute, sessionId?: string | null): string {
  return hashForAppState({
    route,
    mobileView: "chat",
    sessionId: route === "main" ? sessionId ?? null : null,
    agentWorkspaceId: null,
  });
}

export function readInitialRoute(): AppRoute {
  if (typeof window === "undefined") return "main";
  return parseAppHash(window.location.hash).route;
}

export function syncAppHashToUrl(state: AppHashState, replace = false): void {
  if (typeof window === "undefined") return;
  const nextHash = hashForAppState(state);
  if (window.location.hash === nextHash) return;
  const method = replace ? "replaceState" : "pushState";
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
  window.history[method]({ relayRoute: state }, "", nextUrl);
}

export function syncRouteToUrl(route: AppRoute, replace = false): void {
  syncAppHashToUrl({ route, mobileView: "chat", sessionId: null, agentWorkspaceId: null }, replace);
}
