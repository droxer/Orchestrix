"use client";

import { useCallback, useEffect, useState } from "react";
import type { RelaySession } from "../types";
import type { AppRoute, MobileView } from "../lib/viewTypes";
import {
  APP_NAVIGATION_EVENT,
  canonicalBrowserUrl,
  hrefForRoute as buildHrefForRoute,
  parseAppPath,
  syncAppStateToUrl,
  type AppLocationState,
} from "../lib/appRoute";

type UseAppRouterOptions = {
  composingNew: boolean;
  activeSessionId: string | null;
  selectedSessionId: string | undefined;
  activeSession: RelaySession | undefined;
  onApplySessionFromPath: (sessionId: string) => void;
  onSetComposingNewFromPath: (composingNew: boolean) => void;
  onClearPendingMessage: () => void;
};

export function useAppRouter({
  composingNew,
  activeSessionId,
  selectedSessionId,
  activeSession,
  onApplySessionFromPath,
  onSetComposingNewFromPath,
  onClearPendingMessage,
}: UseAppRouterOptions) {
  const [locationState, setLocationState] = useState<AppLocationState>({
    route: "main",
    mobileView: "threads",
    sessionId: null,
  });

  const applyLocationState = useCallback((state: AppLocationState) => {
    setLocationState(state);
    onSetComposingNewFromPath(Boolean(state.composingNew));
    if (state.composingNew) {
      onClearPendingMessage();
    } else if (state.route === "main" && state.sessionId) {
      onClearPendingMessage();
      onApplySessionFromPath(state.sessionId);
    }
  }, [onApplySessionFromPath, onClearPendingMessage, onSetComposingNewFromPath]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === "/") window.history.replaceState(window.history.state, "", "/threads");
    else {
      const canonicalUrl = canonicalBrowserUrl(window.location.pathname, window.location.search);
      if (`${window.location.pathname}${window.location.search}` !== canonicalUrl) {
        window.history.replaceState(window.history.state, "", canonicalUrl);
      }
    }

    const applyCurrentLocation = () => applyLocationState(parseAppPath(window.location.pathname, window.location.search));
    applyCurrentLocation();
    window.addEventListener("popstate", applyCurrentLocation);
    window.addEventListener(APP_NAVIGATION_EVENT, applyCurrentLocation);
    return () => {
      window.removeEventListener("popstate", applyCurrentLocation);
      window.removeEventListener(APP_NAVIGATION_EVENT, applyCurrentLocation);
    };
  }, [applyLocationState]);

  const navigateToAppState = useCallback((state: AppLocationState, replace = false) => {
    applyLocationState(state);
    syncAppStateToUrl(state, replace);
  }, [applyLocationState]);

  const currentSessionId = !composingNew
    ? activeSession?.id ?? selectedSessionId ?? activeSessionId
    : null;

  const navigateToRoute = useCallback((nextRoute: AppRoute) => {
    navigateToAppState({
      route: nextRoute,
      mobileView: nextRoute === "main" ? "threads" : "chat",
      sessionId: null,
    });
  }, [navigateToAppState]);

  const navigateToMobileView = useCallback((nextMobileView: MobileView) => {
    navigateToAppState({
      route: "main",
      mobileView: nextMobileView,
      sessionId: nextMobileView === "chat" ? currentSessionId ?? null : null,
      composingNew: nextMobileView === "chat" && composingNew,
    });
  }, [composingNew, currentSessionId, navigateToAppState]);

  const hrefForSideNavRoute = useCallback((nextRoute: AppRoute) => buildHrefForRoute(nextRoute), []);

  const syncThreadUrl = useCallback((sessionId: string | null, replace = false) => {
    const state: AppLocationState = {
      route: "main",
      mobileView: "chat",
      sessionId,
      composingNew: sessionId === null,
    };
    setLocationState(state);
    syncAppStateToUrl(state, replace);
  }, []);

  const navigateToAgentWorkspace = useCallback((agentId: string) => {
    navigateToAppState({ route: "agents", mobileView: "chat", sessionId: null, agentWorkspaceId: agentId });
  }, [navigateToAppState]);

  const navigateToTeamWorkspace = useCallback((teamId: string | null) => {
    navigateToAppState({ route: "teams", mobileView: "chat", sessionId: null, teamWorkspaceId: teamId });
  }, [navigateToAppState]);

  const navigateToLogin = useCallback((replace = false) => {
    navigateToAppState({ route: "main", mobileView: "chat", sessionId: null, login: true }, replace);
  }, [navigateToAppState]);

  return {
    route: locationState.route,
    mobileView: locationState.mobileView,
    agentWorkspaceId: locationState.agentWorkspaceId ?? null,
    teamWorkspaceId: locationState.teamWorkspaceId ?? null,
    notFound: Boolean(locationState.notFound),
    isLoginPath: Boolean(locationState.login),
    navigateToAppState,
    navigateToRoute,
    navigateToMobileView,
    hrefForSideNavRoute,
    syncThreadUrl,
    navigateToAgentWorkspace,
    navigateToTeamWorkspace,
    navigateToLogin,
  };
}
