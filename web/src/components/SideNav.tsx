import { useEffect, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  NavAdmin, NavAgents, NavBacklog, NavChannels, NavConversations, NavLogout, NavMore, NavPreferences,
  NavTeams,
  NavRoutine, NavSidebarCollapse, NavSidebarExpand,
} from "./icons";
import { RelayMark } from "./RelayMark";
import { Button } from "./ui/button";
import type { AppRoute } from "../lib/viewTypes";

// Left rail: brand, collapse toggle, route nav, settings/logout. Owns its own
// collapsed-state hover tooltip (only shown while the rail is collapsed).
export function SideNav({ sidenavExpanded, setSidenavExpanded, route, onNavigateRoute, hrefForRoute, isAdmin, prefsOpen, setPrefsOpen, onLogout }: {
  sidenavExpanded: boolean;
  setSidenavExpanded: Dispatch<SetStateAction<boolean>>;
  route: AppRoute;
  onNavigateRoute: (route: AppRoute) => void;
  hrefForRoute: (route: AppRoute) => string;
  isAdmin: boolean;
  prefsOpen: boolean;
  setPrefsOpen: Dispatch<SetStateAction<boolean>>;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [navTooltip, setNavTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [settingsMenu, setSettingsMenu] = useState<{ x: number; y: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsMenu) return;

    const firstMenuItem = settingsMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstMenuItem?.focus();

    function closeMenu(returnFocus: boolean) {
      setSettingsMenu(null);
      if (returnFocus) settingsButtonRef.current?.focus();
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (settingsMenuRef.current?.contains(target) || settingsButtonRef.current?.contains(target)) return;
      closeMenu(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(settingsMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + direction + items.length) % items.length;
      items[nextIndex].focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsMenu]);

  useEffect(() => {
    if (!moreMenu) return;

    const firstMenuItem = moreMenuRef.current?.querySelector<HTMLAnchorElement>('[role="menuitem"]');
    firstMenuItem?.focus();

    function closeMenu(returnFocus: boolean) {
      setMoreMenu(null);
      if (returnFocus) moreButtonRef.current?.focus();
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (moreMenuRef.current?.contains(target) || moreButtonRef.current?.contains(target)) return;
      closeMenu(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(moreMenuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? []);
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLAnchorElement);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + direction + items.length) % items.length;
      items[nextIndex].focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreMenu]);

  function showNavTooltip(text: string, el: HTMLElement) {
    if (sidenavExpanded) return;
    const rect = el.getBoundingClientRect();
    setNavTooltip({ text, x: rect.right + 12, y: rect.top + rect.height / 2 });
  }
  function hideNavTooltip() { setNavTooltip(null); }
  function toggleSettingsMenu(el: HTMLElement) {
    hideNavTooltip();
    setMoreMenu(null);
    setSettingsMenu((current) => {
      if (current) return null;
      const rect = el.getBoundingClientRect();
      // Collapsed: fly out to the right of the icon (like the nav tooltips).
      // Expanded: the button is full-width, so align the menu to its left edge
      // and rise above it — otherwise rect.right lands out in the main content
      // area and the menu overlaps the page (e.g. the admin dashboard).
      return sidenavExpanded
        ? { x: rect.left, y: rect.top - 8 }
        : { x: rect.right + 10, y: rect.top - 8 };
    });
  }
  function toggleMoreMenu(el: HTMLElement) {
    hideNavTooltip();
    setSettingsMenu(null);
    setMoreMenu((current) => {
      if (current) return null;
      const rect = el.getBoundingClientRect();
      // Mobile bottom tab: rise above the control, left-aligned to its plate
      // but clamped so the 180px-min menu never clips the right viewport edge
      // (More is the rightmost tab).
      const menuWidth = 188;
      const maxX = window.innerWidth - menuWidth - 8;
      return { x: Math.max(8, Math.min(rect.left, maxX)), y: rect.top - 8 };
    });
  }
  function openPreferences() {
    setSettingsMenu(null);
    setPrefsOpen(true);
  }
  function handleLogout() {
    setSettingsMenu(null);
    onLogout();
  }
  function handleRouteClick(event: MouseEvent<HTMLAnchorElement>, nextRoute: AppRoute) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    setMoreMenu(null);
    onNavigateRoute(nextRoute);
  }

  const moreActive = route === "channels" || route === "admin";

  return (
    <aside className="sidenav-panel" aria-label="Relay" data-expanded={sidenavExpanded ? "true" : "false"}>
      <div className="sidenav-brand-row">
        <div className="sidenav-brand" aria-hidden="true">
          <span className="sidenav-brand-mark"><RelayMark width={24} height={24} /></span>
          <span className="sidenav-brand-copy">
            <span className="sidenav-brand-word">Relay</span>
            <span className="sidenav-brand-meta">{t("nav.workspace")}</span>
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label={sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar")}
          className="sidenav-btn sidenav-toggle"
          onClick={() => setSidenavExpanded((v) => !v)}
          title={sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar")}
          onMouseEnter={(e) => showNavTooltip(sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          {sidenavExpanded ? <NavSidebarCollapse size={16} /> : <NavSidebarExpand size={16} />}
          <span className="sidenav-toggle-label">{sidenavExpanded ? t("nav.collapse") : t("nav.expand")}</span>
        </Button>
      </div>
      <nav className="sidenav-nav" aria-label={t("nav.workspace_label")}>
        <div className="sidenav-group" role="group" aria-label={t("nav.workspace")}>
          <span className="sidenav-group-label" aria-hidden="true">{t("nav.workspace")}</span>
          <a
            className={`sidenav-btn ${route === "main" ? "active" : ""}`}
            data-nav="conversations"
            href={hrefForRoute("main")}
            aria-label={t("nav.conversations")}
            aria-current={route === "main" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "main")}
            onMouseEnter={(e) => showNavTooltip(t("nav.conversations"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.conversations"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavConversations size={18} />
            <span className="sidenav-label">{t("nav.conversations")}</span>
          </a>
          <a
            className={`sidenav-btn ${route === "backlog" ? "active" : ""}`}
            data-nav="backlog"
            href={hrefForRoute("backlog")}
            aria-label={t("nav.backlog_label")}
            aria-current={route === "backlog" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "backlog")}
            onMouseEnter={(e) => showNavTooltip(t("nav.backlog"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.backlog"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavBacklog size={18} />
            <span className="sidenav-label">{t("nav.backlog")}</span>
          </a>
          <a
            className={`sidenav-btn ${route === "routine" ? "active" : ""}`}
            data-nav="routine"
            href={hrefForRoute("routine")}
            aria-label={t("nav.routine_label")}
            aria-current={route === "routine" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "routine")}
            onMouseEnter={(e) => showNavTooltip(t("nav.routine"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.routine"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavRoutine size={18} />
            <span className="sidenav-label">{t("nav.routine")}</span>
          </a>
        </div>
        <div className="sidenav-group sidenav-group--separated" role="group" aria-label={t("nav.workforce")}>
          <span className="sidenav-group-label" aria-hidden="true">{t("nav.workforce")}</span>
          <a
            className={`sidenav-btn ${route === "agents" ? "active" : ""}`}
            data-nav="agents"
            href={hrefForRoute("agents")}
            aria-label={t("nav.agents_label")}
            aria-current={route === "agents" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "agents")}
            onMouseEnter={(e) => showNavTooltip(t("nav.agents"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.agents"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavAgents size={18} />
            <span className="sidenav-label">{t("nav.agents")}</span>
          </a>
          <a
            className={`sidenav-btn ${route === "teams" ? "active" : ""}`}
            data-nav="teams"
            href={hrefForRoute("teams")}
            aria-label={t("nav.teams_label")}
            aria-current={route === "teams" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "teams")}
            onMouseEnter={(event) => showNavTooltip(t("nav.teams"), event.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(event) => showNavTooltip(t("nav.teams"), event.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavTeams size={18} />
            <span className="sidenav-label">{t("nav.teams")}</span>
          </a>
        </div>
        {isAdmin ? (
          <div className="sidenav-group sidenav-group--separated" role="group" aria-label={t("nav.manage")}>
            <span className="sidenav-group-label sidenav-overflow-item" aria-hidden="true">{t("nav.manage")}</span>
            <a
              className={`sidenav-btn sidenav-overflow-item ${route === "channels" ? "active" : ""}`}
              data-nav="channels"
              href={hrefForRoute("channels")}
              aria-label={t("nav.channels_label")}
              aria-current={route === "channels" ? "page" : undefined}
              onClick={(event) => handleRouteClick(event, "channels")}
              onMouseEnter={(e) => showNavTooltip(t("nav.channels"), e.currentTarget)}
              onMouseLeave={hideNavTooltip}
              onFocus={(e) => showNavTooltip(t("nav.channels"), e.currentTarget)}
              onBlur={hideNavTooltip}
            >
              <NavChannels size={18} />
              <span className="sidenav-label">{t("nav.channels")}</span>
            </a>
            <a
              className={`sidenav-btn sidenav-overflow-item ${route === "admin" ? "active" : ""}`}
              data-nav="admin"
              href={hrefForRoute("admin")}
              aria-label={t("nav.admin_label")}
              aria-current={route === "admin" ? "page" : undefined}
              onClick={(event) => handleRouteClick(event, "admin")}
              onMouseEnter={(e) => showNavTooltip(t("nav.admin"), e.currentTarget)}
              onMouseLeave={hideNavTooltip}
              onFocus={(e) => showNavTooltip(t("nav.admin"), e.currentTarget)}
              onBlur={hideNavTooltip}
            >
              <NavAdmin size={18} />
              <span className="sidenav-label">{t("nav.admin")}</span>
            </a>
            <Button
              ref={moreButtonRef}
              type="button"
              variant="ghost"
              className={`sidenav-btn sidenav-more-btn ${moreActive || moreMenu ? "active" : ""}`}
              data-nav="more"
              aria-label={t("nav.more_label")}
              aria-haspopup="menu"
              aria-expanded={Boolean(moreMenu)}
              onClick={(event) => toggleMoreMenu(event.currentTarget)}
            >
              <NavMore size={18} />
              <span className="sidenav-label">{t("nav.more")}</span>
            </Button>
          </div>
        ) : null}
      </nav>
      <div className="sidenav-bottom">
        <Button
          ref={settingsButtonRef}
          variant="ghost"
          className={`sidenav-btn ${prefsOpen || settingsMenu ? "active" : ""}`}
          data-nav="settings"
          type="button"
          aria-haspopup="menu"
          aria-expanded={Boolean(settingsMenu)}
          aria-label={t("nav.settings")}
          onClick={(event) => toggleSettingsMenu(event.currentTarget)}
          onMouseEnter={(e) => showNavTooltip(t("nav.settings"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.settings"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavPreferences size={18} />
          <span className="sidenav-label">{t("nav.settings")}</span>
        </Button>
      </div>
      {/* Portaled to <body>: the mobile bottom bar has a backdrop-filter,
          which makes the panel the containing block for position:fixed —
          rendering these viewport-coordinate overlays inside it would
          mis-place them and scroll the tab row. */}
      {settingsMenu ? createPortal(
        <div
          ref={settingsMenuRef}
          className="sidenav-settings-menu"
          role="menu"
          aria-label={t("nav.settings")}
          style={{ top: settingsMenu.y, left: settingsMenu.x }}
        >
          <Button type="button" variant="ghost" role="menuitem" onClick={openPreferences}>
            <NavPreferences size={16} />
            <span>{t("nav.preferences")}</span>
          </Button>
          <Button type="button" variant="ghost" role="menuitem" className="danger" onClick={handleLogout}>
            <NavLogout size={16} />
            <span>{t("nav.logout")}</span>
          </Button>
        </div>,
        document.body,
      ) : null}
      {moreMenu ? createPortal(
        <div
          ref={moreMenuRef}
          className="sidenav-more-menu"
          role="menu"
          aria-label={t("nav.more_label")}
          style={{ top: moreMenu.y, left: moreMenu.x }}
        >
          <a
            className={`sidenav-more-item ${route === "channels" ? "active" : ""}`}
            role="menuitem"
            href={hrefForRoute("channels")}
            aria-current={route === "channels" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "channels")}
          >
            <NavChannels size={16} />
            <span>{t("nav.channels")}</span>
          </a>
          <a
            className={`sidenav-more-item ${route === "admin" ? "active" : ""}`}
            role="menuitem"
            href={hrefForRoute("admin")}
            aria-current={route === "admin" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "admin")}
          >
            <NavAdmin size={16} />
            <span>{t("nav.admin")}</span>
          </a>
        </div>,
        document.body,
      ) : null}
      {navTooltip ? createPortal(
        <div
          className="sidenav-tooltip"
          role="tooltip"
          style={{ top: navTooltip.y, left: navTooltip.x }}
        >
          {navTooltip.text}
        </div>,
        document.body,
      ) : null}
    </aside>
  );
}
