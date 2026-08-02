import { useEffect, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  NavAdmin, NavAgents, NavBacklog, NavChannels, NavComputer, NavLogout, NavMore, NavPreferences, NavThreads,
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
  setSidenavExpanded: (expanded: boolean) => void;
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
  const tooltipSuppressRef = useRef<HTMLElement | null>(null);
  const [preferencesMenu, setPreferencesMenu] = useState<{ x: number; y: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const preferencesButtonRef = useRef<HTMLButtonElement>(null);
  const preferencesMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!preferencesMenu) return;

    const firstMenuItem = preferencesMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstMenuItem?.focus();

    function closeMenu(returnFocus: boolean) {
      setPreferencesMenu(null);
      if (returnFocus) preferencesButtonRef.current?.focus();
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (preferencesMenuRef.current?.contains(target) || preferencesButtonRef.current?.contains(target)) return;
      closeMenu(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(preferencesMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
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
  }, [preferencesMenu]);

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

  useEffect(() => {
    if (!navTooltip) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      tooltipSuppressRef.current = document.activeElement as HTMLElement | null;
      setNavTooltip(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navTooltip]);

  function showNavTooltip(text: string, el: HTMLElement) {
    if (sidenavExpanded) return;
    if (tooltipSuppressRef.current === el) return;
    const rect = el.getBoundingClientRect();
    setNavTooltip({ text, x: rect.right + 12, y: rect.top + rect.height / 2 });
  }
  function hideNavTooltip() {
    tooltipSuppressRef.current = null;
    setNavTooltip(null);
  }
  function togglePreferencesMenu(el: HTMLElement) {
    hideNavTooltip();
    setMoreMenu(null);
    setPreferencesMenu((current) => {
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
    setPreferencesMenu(null);
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
    setPreferencesMenu(null);
    setPrefsOpen(true);
  }
  function handleLogout() {
    setPreferencesMenu(null);
    onLogout();
  }
  function handleRouteClick(event: MouseEvent<HTMLAnchorElement>, nextRoute: AppRoute) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    setMoreMenu(null);
    onNavigateRoute(nextRoute);
  }

  const moreActive = route === "admin";
  const channelsHint = `${t("nav.channels")} · ${t("nav.coming_soon")}`;

  return (
    <aside className="sidenav-panel" aria-label={t("nav.brand", { defaultValue: "Relay" })} data-expanded={sidenavExpanded ? "true" : "false"}>
      {/* Brand only. The collapse toggle used to share this row and had to
          drop onto a second line when the rail narrowed to 72px (a 36px mark
          and a 32px control do not fit), so the button jumped ~70px out from
          under the cursor that had just clicked it. It now lives in the
          footer with the other rail-level control, at a stable position in
          both states. */}
      <div className="sidenav-brand-row">
        <div className="sidenav-brand" aria-hidden="true">
          <span className="sidenav-brand-mark"><RelayMark width={24} height={24} /></span>
          <span className="sidenav-brand-copy">
            <span className="sidenav-brand-word sr-only">Relay</span>
          </span>
        </div>
      </div>
      <nav className="sidenav-nav" aria-label={t("nav.workspace_label")}>
        <div className="sidenav-group" role="group">
          <a
            className={`sidenav-btn ${route === "main" ? "active" : ""}`}
            data-nav="threads"
            href={hrefForRoute("main")}
            aria-label={t("nav.threads")}
            aria-current={route === "main" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "main")}
            onMouseEnter={(e) => showNavTooltip(t("nav.threads"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.threads"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavThreads size={18} />
            <span className="sidenav-label sr-only">{t("nav.threads")}</span>
          </a>
        </div>
        <div className="sidenav-group sidenav-group--separated" role="group" aria-label={t("nav.workspace")}>
          <span className="sidenav-group-label sr-only" aria-hidden="true">{t("nav.workspace")}</span>
          <a
            className={`sidenav-btn ${route === "backlog" ? "active" : ""}`}
            data-nav="backlog"
            href={hrefForRoute("backlog")}
            aria-label={t("nav.backlog")}
            aria-current={route === "backlog" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "backlog")}
            onMouseEnter={(e) => showNavTooltip(t("nav.backlog"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.backlog"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavBacklog size={18} />
            <span className="sidenav-label sr-only">{t("nav.backlog")}</span>
          </a>
          <a
            className={`sidenav-btn ${route === "routine" ? "active" : ""}`}
            data-nav="routine"
            href={hrefForRoute("routine")}
            aria-label={t("nav.routine")}
            aria-current={route === "routine" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "routine")}
            onMouseEnter={(e) => showNavTooltip(t("nav.routine"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.routine"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavRoutine size={18} />
            <span className="sidenav-label sr-only">{t("nav.routine")}</span>
          </a>
          {/* Lives in Workspace, not beside Threads: ComputerPage's own
              header prints the "Workspace" kicker, so the rail has to agree
              with the breadcrumb the page shows. */}
          <a
            className={`sidenav-btn ${route === "computer" ? "active" : ""}`}
            data-nav="computer"
            href={hrefForRoute("computer")}
            aria-label={t("nav.computer")}
            aria-current={route === "computer" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "computer")}
            onMouseEnter={(e) => showNavTooltip(t("nav.computer"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.computer"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavComputer size={18} aria-hidden="true" />
            <span className="sidenav-label sr-only">{t("nav.computer")}</span>
          </a>
        </div>
        <div className="sidenav-group sidenav-group--separated" role="group" aria-label={t("nav.workforce")}>
          <span className="sidenav-group-label sr-only" aria-hidden="true">{t("nav.workforce")}</span>
          <a
            className={`sidenav-btn ${route === "agents" ? "active" : ""}`}
            data-nav="agents"
            href={hrefForRoute("agents")}
            aria-label={t("nav.agents")}
            aria-current={route === "agents" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "agents")}
            onMouseEnter={(e) => showNavTooltip(t("nav.agents"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.agents"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavAgents size={18} />
            <span className="sidenav-label sr-only">{t("nav.agents")}</span>
          </a>
          <a
            className={`sidenav-btn ${route === "teams" ? "active" : ""}`}
            data-nav="teams"
            href={hrefForRoute("teams")}
            aria-label={t("nav.teams")}
            aria-current={route === "teams" ? "page" : undefined}
            onClick={(event) => handleRouteClick(event, "teams")}
            onMouseEnter={(event) => showNavTooltip(t("nav.teams"), event.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(event) => showNavTooltip(t("nav.teams"), event.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavTeams size={18} />
            <span className="sidenav-label sr-only">{t("nav.teams")}</span>
          </a>
        </div>
        {isAdmin ? (
          <div className="sidenav-group sidenav-group--separated" role="group" aria-label={t("nav.manage")}>
            <span className="sidenav-group-label sidenav-overflow-item sr-only" aria-hidden="true">{t("nav.manage")}</span>
            {/* Keeps role=button + aria-disabled so assistive tech still
                announces it as an unavailable destination, but drops
                tabIndex: it has no activation handler, so a keyboard user
                tabbing in hit a dead stop with no way to learn why. The
                focus tooltip goes with it. */}
            <span
              className="sidenav-btn sidenav-overflow-item"
              data-nav="channels"
              role="button"
              aria-disabled="true"
              aria-label={channelsHint}
              onMouseEnter={(e) => showNavTooltip(channelsHint, e.currentTarget)}
              onMouseLeave={hideNavTooltip}
            >
              <NavChannels size={18} />
              <span className="sidenav-label sr-only">{t("nav.channels")}</span>
              <span className="sidenav-badge" aria-hidden="true">{t("nav.coming_soon_short")}</span>
              <span className="sidenav-badge-dot" aria-hidden="true" />
            </span>
            <a
              className={`sidenav-btn sidenav-overflow-item ${route === "admin" ? "active" : ""}`}
              data-nav="admin"
              href={hrefForRoute("admin")}
              aria-label={t("nav.admin")}
              aria-current={route === "admin" ? "page" : undefined}
              onClick={(event) => handleRouteClick(event, "admin")}
              onMouseEnter={(e) => showNavTooltip(t("nav.admin"), e.currentTarget)}
              onMouseLeave={hideNavTooltip}
              onFocus={(e) => showNavTooltip(t("nav.admin"), e.currentTarget)}
              onBlur={hideNavTooltip}
            >
              <NavAdmin size={18} />
              <span className="sidenav-label sr-only">{t("nav.admin")}</span>
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
              onMouseEnter={(e) => showNavTooltip(t("nav.more"), e.currentTarget)}
              onMouseLeave={hideNavTooltip}
              onFocus={(e) => showNavTooltip(t("nav.more"), e.currentTarget)}
              onBlur={hideNavTooltip}
            >
              <NavMore size={18} />
              <span className="sidenav-label sr-only">{t("nav.more")}</span>
            </Button>
          </div>
        ) : null}
      </nav>
      <div className="sidenav-bottom">
        <Button
          type="button"
          variant="ghost"
          aria-label={sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar")}
          className="sidenav-btn sidenav-toggle"
          data-nav="collapse"
          onClick={() => setSidenavExpanded(!sidenavExpanded)}
          title={sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar")}
          onMouseEnter={(e) => showNavTooltip(sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(sidenavExpanded ? t("nav.collapse_sidebar") : t("nav.expand_sidebar"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          {sidenavExpanded ? <NavSidebarCollapse size={18} /> : <NavSidebarExpand size={18} />}
          <span className="sidenav-label sr-only">{sidenavExpanded ? t("nav.collapse") : t("nav.expand")}</span>
        </Button>
        <Button
          ref={preferencesButtonRef}
          variant="ghost"
          className={`sidenav-btn ${prefsOpen || preferencesMenu ? "active" : ""}`}
          data-nav="settings"
          type="button"
          aria-haspopup="menu"
          aria-expanded={Boolean(preferencesMenu)}
          aria-label={t("nav.preferences")}
          onClick={(event) => togglePreferencesMenu(event.currentTarget)}
          onMouseEnter={(e) => showNavTooltip(t("nav.preferences"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.preferences"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavPreferences size={18} />
          <span className="sidenav-label sr-only">{t("nav.preferences")}</span>
        </Button>
      </div>
      {/* Portaled to <body>: the mobile bottom bar is a horizontal scroll
          container, so these viewport-coordinate overlays render against the
          viewport instead of the panel. */}
      {preferencesMenu ? createPortal(
        <div
          ref={preferencesMenuRef}
          className="sidenav-settings-menu"
          role="menu"
          aria-label={t("nav.preferences")}
          style={{ top: preferencesMenu.y, left: preferencesMenu.x }}
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
          <span className="sidenav-more-item" role="menuitem" aria-disabled="true">
            <NavChannels size={16} />
            <span>{t("nav.channels")}</span>
            <span className="sidenav-badge" aria-hidden="true">{t("nav.coming_soon_short")}</span>
          </span>
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
