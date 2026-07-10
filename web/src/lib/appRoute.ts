import type { AppRoute, MobileView } from "./viewTypes.js";

const WORK_ROUTES = new Set<AppRoute>(["workspace", "backlog", "routine", "agents", "channels", "admin"]);

export type AppHashState = {
  route: AppRoute;
  mobileView: MobileView;
  sessionId: string | null;
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
  const [head, sessionId] = hashSegments(hash);
  if (head && WORK_ROUTES.has(head as AppRoute)) {
    return { route: head as AppRoute, mobileView: "chat", sessionId: null };
  }
  if (head === "threads") return { route: "main", mobileView: "threads", sessionId: null };
  if (head === "chat") return { route: "main", mobileView: "chat", sessionId: sessionId ?? null };
  return { route: "main", mobileView: "chat", sessionId: null };
}

export function hashForAppState({ route, mobileView, sessionId }: AppHashState): string {
  if (route !== "main") return `#/${route}`;
  if (mobileView === "threads") return "#/threads";
  return sessionId ? `#/chat/${encodeURIComponent(sessionId)}` : "#/chat";
}

export function hrefForRoute(route: AppRoute, sessionId?: string | null): string {
  return hashForAppState({
    route,
    mobileView: "chat",
    sessionId: route === "main" ? sessionId ?? null : null,
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
  syncAppHashToUrl({ route, mobileView: "chat", sessionId: null }, replace);
}
