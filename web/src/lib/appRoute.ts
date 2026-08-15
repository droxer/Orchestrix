import type { AppRoute, MobileView } from "./viewTypes.js";

const WORK_PATHS: Record<Exclude<AppRoute, "main" | "projects">, string> = {
  backlog: "/backlog",
  routine: "/routines",
  agents: "/agents",
  teams: "/teams",
  channels: "/channels",
  admin: "/admin",
  computer: "/computer",
};

const WORK_ROUTES = new Map(Object.entries(WORK_PATHS).map(([route, path]) => [path, route as AppRoute]));

export const APP_NAVIGATION_EVENT = "relay:navigation";

export type AppLocationState = {
  route: AppRoute;
  mobileView: MobileView;
  sessionId: string | null;
  projectId?: string | null;
  agentWorkspaceId?: string | null;
  teamWorkspaceId?: string | null;
  composingNew?: boolean;
  login?: boolean;
  notFound?: boolean;
};

function decodeSegment(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function pathSegments(pathname: string): string[] {
  return pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

export function parseAppPath(pathname: string, _search = ""): AppLocationState {
  const normalized = pathname === "/" ? "/threads" : `/${pathSegments(pathname).join("/")}`;
  const [head, second, ...rest] = pathSegments(normalized);
  const base = { mobileView: "chat" as const, sessionId: null };

  if (normalized === "/login") return { route: "main", ...base, login: true };
  if (normalized === "/threads") return { route: "main", mobileView: "threads", sessionId: null };
  if (head === "threads" && second === "new" && rest.length === 0) {
    return { route: "main", ...base, composingNew: true };
  }
  if (head === "threads" && second && rest.length === 0) {
    return { route: "main", ...base, sessionId: decodeSegment(second) };
  }
  if (head === "projects" && !second && rest.length === 0) {
    return { route: "projects", mobileView: "threads", sessionId: null };
  }
  if (head === "projects" && second && rest.length === 0) {
    return { route: "projects", mobileView: "threads", sessionId: null, projectId: decodeSegment(second) };
  }
  if (head === "projects" && second && rest[0] === "new" && rest.length === 1) {
    return { route: "projects", ...base, projectId: decodeSegment(second), composingNew: true };
  }
  if (head === "projects" && second && rest[0] === "threads" && rest[1] && rest.length === 2) {
    return { route: "projects", ...base, projectId: decodeSegment(second), sessionId: decodeSegment(rest[1]) };
  }
  if (head === "agents" && second && rest.length === 0) {
    return { route: "agents", ...base, agentWorkspaceId: decodeSegment(second) };
  }
  if (head === "teams" && second && rest.length === 0) {
    return { route: "teams", ...base, teamWorkspaceId: decodeSegment(second) };
  }
  const workRoute = WORK_ROUTES.get(normalized);
  if (workRoute) return { route: workRoute, ...base };
  return { route: "main", ...base, notFound: true };
}

export function pathForAppState({
  route,
  mobileView,
  sessionId,
  projectId,
  agentWorkspaceId,
  teamWorkspaceId,
  composingNew,
  login,
  notFound,
}: AppLocationState): string {
  if (notFound && typeof window !== "undefined") return window.location.pathname;
  if (login) return "/login";
  if (route === "agents" && agentWorkspaceId) return `/agents/${encodeURIComponent(agentWorkspaceId)}`;
  if (route === "teams" && teamWorkspaceId) return `/teams/${encodeURIComponent(teamWorkspaceId)}`;
  if (route === "projects") {
    if (!projectId) return "/projects";
    const projectPath = `/projects/${encodeURIComponent(projectId)}`;
    if (mobileView === "threads") return projectPath;
    if (composingNew) return `${projectPath}/new`;
    return sessionId ? `${projectPath}/threads/${encodeURIComponent(sessionId)}` : projectPath;
  }
  if (route !== "main") return WORK_PATHS[route];
  if (mobileView === "threads") return "/threads";
  if (composingNew) return "/threads/new";
  return sessionId ? `/threads/${encodeURIComponent(sessionId)}` : "/threads";
}

export function hrefForRoute(route: AppRoute, sessionId?: string | null): string {
  return pathForAppState({
    route,
    mobileView: (route === "main" || route === "projects") && !sessionId ? "threads" : "chat",
    sessionId: route === "main" ? sessionId ?? null : null,
  });
}

const AGENT_TABS = new Set(["profile", "activities", "workspace"]);
const TEAM_TABS = new Set(["profile", "activities", "workspace"]);
const AGENT_AVAILABILITY = new Set(["ready", "busy", "pending", "offline"]);

function copyParam(source: URLSearchParams, target: URLSearchParams, key: string): void {
  const value = source.get(key);
  if (value) target.set(key, value);
}

/** Returns only query parameters owned by the current route and tab. */
export function canonicalSearchForPath(pathname: string, search = ""): string {
  const source = new URLSearchParams(search);
  const target = new URLSearchParams();
  const [head, entityId, ...rest] = pathSegments(pathname);

  if (head === "login" && !entityId) {
    const rawReturnTo = source.get("returnTo");
    if (rawReturnTo) target.set("returnTo", validatedReturnTo(rawReturnTo));
  } else if (
    (head === "threads" && entityId !== "new" && rest.length === 0)
    || (head === "projects" && Boolean(entityId) && rest[0] === "threads" && Boolean(rest[1]) && rest.length === 2)
  ) {
    // The thread space panel is URL-driven (?space=1&artifact=<id>) so an open
    // panel survives reload and can be shared. The selection only means
    // something while the panel is open.
    // The bare /threads path owns these too: on desktop it still shows a
    // thread (the most recent one, picked as the fallback), so the panel can
    // be opened from there. Dropping the params on that path made the toggle
    // write space=1 and have it canonicalized straight back out — a click
    // that did nothing at all. Only /threads/new has no thread to describe.
    if (source.get("space") === "1") {
      target.set("space", "1");
      copyParam(source, target, "artifact");
    }
  } else if (head === "agents" && !entityId) {
    copyParam(source, target, "q");
    const availability = source.get("availability");
    if (availability && AGENT_AVAILABILITY.has(availability)) {
      target.set("availability", availability);
    }
  } else if (head === "agents" && entityId && rest.length === 0) {
    const requestedTab = source.get("tab");
    const tab = requestedTab && AGENT_TABS.has(requestedTab) ? requestedTab : "profile";
    if (tab !== "profile") target.set("tab", tab);
    if (tab === "workspace") {
      if (source.get("scope") === "shared") target.set("scope", "shared");
      copyParam(source, target, "path");
      copyParam(source, target, "item");
    }
  } else if (head === "teams" && !entityId) {
    if (source.get("dialog") === "create") target.set("dialog", "create");
  } else if (head === "teams" && entityId && rest.length === 0) {
    const requestedTab = source.get("tab");
    const tab = requestedTab && TEAM_TABS.has(requestedTab) ? requestedTab : "profile";
    if (tab !== "profile") target.set("tab", tab);
    if (tab === "workspace") {
      copyParam(source, target, "path");
      copyParam(source, target, "item");
    }
  }

  const encoded = target.toString();
  return encoded ? `?${encoded}` : "";
}

export function canonicalBrowserUrl(pathname: string, search = ""): string {
  return `${pathname}${canonicalSearchForPath(pathname, search)}`;
}

/** Whether `?space=1` survives on this path. A surface that writes a search
 *  param the path does not own gets it canonicalized straight back out, so
 *  the write silently does nothing — assert ownership here rather than
 *  discovering it as a dead control. */
export function pathKeepsThreadSpaceParams(pathname: string): boolean {
  return canonicalSearchForPath(pathname, "?space=1") !== "";
}

export function validatedReturnTo(value: string | null, origin = "http://relay.local"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/threads";
  try {
    const candidate = new URL(value, origin);
    if (candidate.origin !== origin) return "/threads";
    const state = parseAppPath(candidate.pathname, candidate.search);
    if (state.notFound || state.login) return "/threads";
    return canonicalBrowserUrl(candidate.pathname, candidate.search);
  } catch {
    return "/threads";
  }
}

export function readInitialRoute(): AppRoute {
  if (typeof window === "undefined") return "main";
  return parseAppPath(window.location.pathname, window.location.search).route;
}

/**
 * The browser URL a state change should land on.
 *
 * Staying on the same path keeps that path's own canonical params: the thread
 * space panel is URL-driven (`?space=1&artifact=…`), so a send inside an open
 * thread — the team-room case, where artifacts pile up — must not silently
 * close the panel. Moving to a different path starts clean, because an
 * artifact selection only describes the thread it came from.
 */
export function browserUrlForAppState(
  state: AppLocationState,
  currentPathname: string,
  currentSearch = "",
): string {
  const nextPath = pathForAppState(state);
  return nextPath === currentPathname ? canonicalBrowserUrl(nextPath, currentSearch) : nextPath;
}

export function syncAppStateToUrl(state: AppLocationState, replace = false): void {
  if (typeof window === "undefined") return;
  const nextUrl = browserUrlForAppState(state, window.location.pathname, window.location.search);
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === nextUrl) return;
  window.history[replace ? "replaceState" : "pushState"]({ relayRoute: state }, "", nextUrl);
  window.dispatchEvent(new Event(APP_NAVIGATION_EVENT));
}

export function syncRouteToUrl(route: AppRoute, replace = false): void {
  syncAppStateToUrl({
    route,
    mobileView: route === "main" || route === "projects" ? "threads" : "chat",
    sessionId: null,
  }, replace);
}

/** Push an in-app path (search params allowed) and notify route/search listeners. */
export function navigateToAppPath(path: string): void {
  if (typeof window === "undefined") return;
  window.history.pushState(window.history.state, "", path);
  window.dispatchEvent(new Event(APP_NAVIGATION_EVENT));
}
