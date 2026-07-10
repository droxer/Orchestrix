import { useEffect, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  NavAdmin, NavAgents, NavBacklog, NavChannels, NavConversations, NavLogout, NavPreferences,
  NavRoutine, NavSidebarCollapse, NavSidebarExpand, NavWorkspace,
} from "./icons";
import { RelayMark } from "./RelayMark";
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
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

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

  function showNavTooltip(text: string, el: HTMLElement) {
    if (sidenavExpanded) return;
    const rect = el.getBoundingClientRect();
    setNavTooltip({ text, x: rect.right + 12, y: rect.top + rect.height / 2 });
  }
  function hideNavTooltip() { setNavTooltip(null); }
  function toggleSettingsMenu(el: HTMLElement) {
    hideNavTooltip();
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
    onNavigateRoute(nextRoute);
  }

  return (
    <aside className="sidenav-panel" aria-label="Relay" data-expanded={sidenavExpanded ? "true" : "false"}>
      <div className="sidenav-brand-row">
        <div className="sidenav-brand" aria-hidden="true">
          <RelayMark width={28} height={28} />
          <span className="sidenav-brand-word">Relay</span>
        </div>
        <button
          type="button"
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
        </button>
      </div>
      <nav className="sidenav-nav" aria-label={t("nav.conversations")}>
        <a
          className={`sidenav-btn ${route === "main" ? "active" : ""}`}
          data-nav="conversations"
          href={hrefForRoute("main")}
          aria-label={t("nav.conversations")}
          aria-current={route === "main" ? "page" : undefined}
          title={t("nav.conversations")}
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
          className={`sidenav-btn ${route === "workspace" ? "active" : ""}`}
          data-nav="workspace"
          href={hrefForRoute("workspace")}
          aria-label={t("nav.workspace_label")}
          aria-current={route === "workspace" ? "page" : undefined}
          title={t("nav.workspace_label")}
          onClick={(event) => handleRouteClick(event, "workspace")}
          onMouseEnter={(e) => showNavTooltip(t("nav.workspace"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.workspace"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavWorkspace size={18} />
          <span className="sidenav-label">{t("nav.workspace")}</span>
        </a>
        <a
          className={`sidenav-btn ${route === "backlog" ? "active" : ""}`}
          data-nav="backlog"
          href={hrefForRoute("backlog")}
          aria-label={t("nav.backlog_label")}
          aria-current={route === "backlog" ? "page" : undefined}
          title={t("nav.backlog_label")}
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
          title={t("nav.routine_label")}
          onClick={(event) => handleRouteClick(event, "routine")}
          onMouseEnter={(e) => showNavTooltip(t("nav.routine"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.routine"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavRoutine size={18} />
          <span className="sidenav-label">{t("nav.routine")}</span>
        </a>
        <a
          className={`sidenav-btn ${route === "agents" ? "active" : ""}`}
          data-nav="agents"
          href={hrefForRoute("agents")}
          aria-label={t("nav.agents_label")}
          aria-current={route === "agents" ? "page" : undefined}
          title={t("nav.agents_label")}
          onClick={(event) => handleRouteClick(event, "agents")}
          onMouseEnter={(e) => showNavTooltip(t("nav.agents"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.agents"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavAgents size={18} />
          <span className="sidenav-label">{t("nav.agents")}</span>
        </a>
        {isAdmin ? (
          <>
            <div className="sidenav-separator" aria-hidden="true" />
            <a
              className={`sidenav-btn ${route === "channels" ? "active" : ""}`}
              data-nav="channels"
              href={hrefForRoute("channels")}
              aria-label={t("nav.channels_label")}
              aria-current={route === "channels" ? "page" : undefined}
              title={t("nav.channels_label")}
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
              className={`sidenav-btn ${route === "admin" ? "active" : ""}`}
              data-nav="admin"
              href={hrefForRoute("admin")}
              aria-label={t("nav.admin_label")}
              aria-current={route === "admin" ? "page" : undefined}
              title={t("nav.admin_label")}
              onClick={(event) => handleRouteClick(event, "admin")}
              onMouseEnter={(e) => showNavTooltip(t("nav.admin"), e.currentTarget)}
              onMouseLeave={hideNavTooltip}
              onFocus={(e) => showNavTooltip(t("nav.admin"), e.currentTarget)}
              onBlur={hideNavTooltip}
            >
              <NavAdmin size={18} />
              <span className="sidenav-label">{t("nav.admin")}</span>
            </a>
          </>
        ) : null}
      </nav>
      <div className="sidenav-bottom">
        <button
          ref={settingsButtonRef}
          className={`sidenav-btn ${prefsOpen || settingsMenu ? "active" : ""}`}
          data-nav="settings"
          type="button"
          aria-haspopup="menu"
          aria-expanded={Boolean(settingsMenu)}
          aria-label={t("nav.settings")}
          title={t("nav.settings")}
          onClick={(event) => toggleSettingsMenu(event.currentTarget)}
          onMouseEnter={(e) => showNavTooltip(t("nav.settings"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.settings"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavPreferences size={18} />
          <span className="sidenav-label">{t("nav.settings")}</span>
        </button>
      </div>
      {settingsMenu ? (
        <div
          ref={settingsMenuRef}
          className="sidenav-settings-menu"
          role="menu"
          aria-label={t("nav.settings")}
          style={{ top: settingsMenu.y, left: settingsMenu.x }}
        >
          <button type="button" role="menuitem" onClick={openPreferences}>
            <NavPreferences size={16} />
            <span>{t("nav.preferences")}</span>
          </button>
          <button type="button" role="menuitem" className="danger" onClick={handleLogout}>
            <NavLogout size={16} />
            <span>{t("nav.logout")}</span>
          </button>
        </div>
      ) : null}
      {navTooltip ? (
        <div
          className="sidenav-tooltip"
          role="tooltip"
          style={{ top: navTooltip.y, left: navTooltip.x }}
        >
          {navTooltip.text}
        </div>
      ) : null}
    </aside>
  );
}
