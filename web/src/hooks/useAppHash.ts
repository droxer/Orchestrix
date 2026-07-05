"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RelaySession } from "../types";
import type { AppRoute, MobileView } from "../lib/viewTypes";
import {
  hrefForRoute as buildHrefForRoute,
  parseAppHash,
  readInitialRoute,
  syncAppHashToUrl,
  type AppHashState,
} from "../lib/appRoute";

type UseAppHashOptions = {
  composingNew: boolean;
  activeSessionId: string | null;
  selectedSessionId: string | undefined;
  activeSession: RelaySession | undefined;
  onApplySessionFromHash: (sessionId: string) => void;
  onClearPendingMessage: () => void;
};

export function useAppHash({
  composingNew,
  activeSessionId,
  selectedSessionId,
  activeSession,
  onApplySessionFromHash,
  onClearPendingMessage,
}: UseAppHashOptions) {
  const skipInitialHashSyncRef = useRef(true);
  const [route, setRoute] = useState<AppRoute>(() => readInitialRoute());
  const [mobileView, setMobileView] = useState<MobileView>(() =>
    typeof window !== "undefined" ? parseAppHash(window.location.hash).mobileView : "chat",
  );

  const appHashSessionId = route === "main" && !composingNew
    ? activeSession?.id ?? selectedSessionId ?? activeSessionId
    : null;

  const currentAppHashState = useMemo<AppHashState>(() => ({
    route,
    mobileView,
    sessionId: appHashSessionId ?? null,
  }), [appHashSessionId, mobileView, route]);

  const applyHashState = useCallback((state: AppHashState) => {
    setRoute(state.route);
    setMobileView(state.mobileView);
    if (state.route === "main" && state.sessionId) {
      onClearPendingMessage();
      onApplySessionFromHash(state.sessionId);
    }
  }, [onApplySessionFromHash, onClearPendingMessage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function applyCurrentHash() {
      applyHashState(parseAppHash(window.location.hash));
    }
    applyCurrentHash();
    if (!window.location.hash) syncAppHashToUrl(parseAppHash(""), true);
    window.addEventListener("hashchange", applyCurrentHash);
    window.addEventListener("popstate", applyCurrentHash);
    return () => {
      window.removeEventListener("hashchange", applyCurrentHash);
      window.removeEventListener("popstate", applyCurrentHash);
    };
  }, [applyHashState]);

  useEffect(() => {
    if (skipInitialHashSyncRef.current) {
      skipInitialHashSyncRef.current = false;
      return;
    }
    syncAppHashToUrl(currentAppHashState, true);
  }, [currentAppHashState]);

  const navigateToAppState = useCallback((state: AppHashState, replace = false) => {
    applyHashState(state);
    syncAppHashToUrl(state, replace);
  }, [applyHashState]);

  const navigateToRoute = useCallback((nextRoute: AppRoute) => {
    navigateToAppState({
      route: nextRoute,
      mobileView: "chat",
      sessionId: nextRoute === "main" && !composingNew
        ? activeSession?.id ?? selectedSessionId ?? activeSessionId
        : null,
    });
  }, [activeSession?.id, activeSessionId, composingNew, navigateToAppState, selectedSessionId]);

  const navigateToMobileView = useCallback((nextMobileView: MobileView) => {
    navigateToAppState({
      route: "main",
      mobileView: nextMobileView,
      sessionId: nextMobileView === "chat" && !composingNew
        ? activeSession?.id ?? selectedSessionId ?? activeSessionId
        : null,
    });
  }, [activeSession?.id, activeSessionId, composingNew, navigateToAppState, selectedSessionId]);

  const hrefForSideNavRoute = useCallback((nextRoute: AppRoute) => buildHrefForRoute(
    nextRoute,
    nextRoute === "main" && !composingNew ? activeSession?.id ?? selectedSessionId ?? activeSessionId : null,
  ), [activeSession?.id, activeSessionId, composingNew, selectedSessionId]);

  const syncChatHash = useCallback((sessionId: string | null, replace = false) => {
    setRoute("main");
    setMobileView("chat");
    syncAppHashToUrl({ route: "main", mobileView: "chat", sessionId }, replace);
  }, []);

  return {
    route,
    mobileView,
    navigateToAppState,
    navigateToRoute,
    navigateToMobileView,
    hrefForSideNavRoute,
    syncChatHash,
  };
}
