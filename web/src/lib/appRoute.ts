import type { AppRoute, MobileView } from "./viewTypes.js";

const WORK_PATHS: Record<Exclude<AppRoute, "main">, string> = {
  backlog: "/backlog",
  routine: "/routines",
  agents: "/agents",
  teams: "/teams",
  channels: "/channels",
  admin: "/admin",
};

const WORK_ROUTES = new Map(Object.entries(WORK_PATHS).map(([route, path]) => [path, route as AppRoute]));

export const APP_NAVIGATION_EVENT = "relay:navigation";

export type AppLocationState = {
  route: AppRoute;
  mobileView: MobileView;
  sessionId: string | null;
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
  if (route !== "main") return WORK_PATHS[route];
  if (mobileView === "threads") return "/threads";
  if (composingNew) return "/threads/new";
  return sessionId ? `/threads/${encodeURIComponent(sessionId)}` : "/threads";
}

export function hrefForRoute(route: AppRoute, sessionId?: string | null): string {
  return pathForAppState({
    route,
    mobileView: route === "main" && !sessionId ? "threads" : "chat",
    sessionId: route === "main" ? sessionId ?? null : null,
  });
}

function legacyQuery(hash: string, search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  for (const [key, value] of new URLSearchParams(hash.split("?", 2)[1] ?? "")) params.set(key, value);
  return params;
}

/** Converts one-release hash bookmarks to their canonical pathname and query. */
export function legacyHashUrl(hash: string, search = ""): string | null {
  if (!hash.startsWith("#/")) return null;
  const hashPath = hash.split("?", 1)[0]?.slice(1) ?? "";
  const [head, second, third] = pathSegments(hashPath);
  const old = legacyQuery(hash, search);
  const next = new URLSearchParams();
  let pathname: string;

  if (head === "chat") pathname = second ? `/threads/${encodeURIComponent(decodeSegment(second) ?? second)}` : "/threads";
  else if (head === "threads") pathname = "/threads";
  else if (head === "routine" || head === "routines") pathname = "/routines";
  else if (head === "agents" && second && third === "workspace") {
    pathname = `/agents/${encodeURIComponent(decodeSegment(second) ?? second)}`;
    for (const [legacy, canonical] of [["workspaceTab", "tab"], ["workspaceScope", "scope"], ["workspacePath", "path"], ["workspaceItem", "item"]]) {
      const value = old.get(legacy);
      if (value) next.set(canonical, value);
    }
  } else if (head === "agents") {
    pathname = "/agents";
    const query = old.get("agentsQ");
    const availability = old.get("agentsFilter");
    if (query) next.set("q", query);
    if (availability) next.set("availability", availability);
  } else if (head === "teams") {
    const teamId = old.get("team");
    pathname = teamId ? `/teams/${encodeURIComponent(teamId)}` : "/teams";
    if (old.get("addTeam") === "1") next.set("dialog", "create");
    const tab = old.get("teamTab");
    const artifact = old.get("teamArtifact");
    if (tab) next.set("tab", tab);
    if (artifact) next.set("artifact", artifact);
  } else if (head === "backlog") pathname = "/backlog";
  else if (head === "channels") pathname = "/channels";
  else if (head === "admin") pathname = "/admin";
  else return "/threads";

  const query = next.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

export function validatedReturnTo(value: string | null, origin = "http://relay.local"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/threads";
  try {
    const candidate = new URL(value, origin);
    if (candidate.origin !== origin) return "/threads";
    const state = parseAppPath(candidate.pathname, candidate.search);
    if (state.notFound || state.login) return "/threads";
    return `${candidate.pathname}${candidate.search}`;
  } catch {
    return "/threads";
  }
}

export function readInitialRoute(): AppRoute {
  if (typeof window === "undefined") return "main";
  return parseAppPath(window.location.pathname, window.location.search).route;
}

export function syncAppStateToUrl(state: AppLocationState, replace = false): void {
  if (typeof window === "undefined") return;
  const nextUrl = pathForAppState(state);
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === nextUrl) return;
  window.history[replace ? "replaceState" : "pushState"]({ relayRoute: state }, "", nextUrl);
  window.dispatchEvent(new Event(APP_NAVIGATION_EVENT));
}

export function syncRouteToUrl(route: AppRoute, replace = false): void {
  syncAppStateToUrl({ route, mobileView: route === "main" ? "threads" : "chat", sessionId: null }, replace);
}
