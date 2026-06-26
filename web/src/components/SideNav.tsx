import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  NavAdmin, NavBacklog, NavChannels, NavConversations, NavLogout, NavMcp, NavPreferences,
  NavRoutine, NavSidebarCollapse, NavSidebarExpand, NavSkills,
} from "./icons";
import { RelayMark } from "./RelayMark";
import type { AppRoute } from "../lib/viewTypes";

// Left rail: brand, collapse toggle, route nav, settings/logout. Owns its own
// collapsed-state hover tooltip (only shown while the rail is collapsed).
export function SideNav({ sidenavExpanded, setSidenavExpanded, route, setRoute, isAdmin, prefsOpen, setPrefsOpen, onLogout }: {
  sidenavExpanded: boolean;
  setSidenavExpanded: Dispatch<SetStateAction<boolean>>;
  route: AppRoute;
  setRoute: Dispatch<SetStateAction<AppRoute>>;
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
      return { x: rect.right + 10, y: rect.top - 8 };
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
        <button
          className={`sidenav-btn ${route === "main" ? "active" : ""}`}
          data-nav="conversations"
          type="button"
          aria-label={t("nav.conversations")}
          aria-pressed={route === "main"}
          title={t("nav.conversations")}
          onClick={() => setRoute("main")}
          onMouseEnter={(e) => showNavTooltip(t("nav.conversations"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.conversations"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavConversations size={18} />
          <span className="sidenav-label">{t("nav.conversations")}</span>
        </button>
        <button
          className={`sidenav-btn ${route === "backlog" ? "active" : ""}`}
          data-nav="backlog"
          type="button"
          aria-label={t("nav.backlog_label")}
          aria-pressed={route === "backlog"}
          title={t("nav.backlog_label")}
          onClick={() => setRoute((r) => r === "backlog" ? "main" : "backlog")}
          onMouseEnter={(e) => showNavTooltip(t("nav.backlog"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.backlog"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavBacklog size={18} />
          <span className="sidenav-label">{t("nav.backlog")}</span>
        </button>
        <button
          className={`sidenav-btn ${route === "routine" ? "active" : ""}`}
          data-nav="routine"
          type="button"
          aria-label={t("nav.routine_label")}
          aria-pressed={route === "routine"}
          title={t("nav.routine_label")}
          onClick={() => setRoute((r) => r === "routine" ? "main" : "routine")}
          onMouseEnter={(e) => showNavTooltip(t("nav.routine"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.routine"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavRoutine size={18} />
          <span className="sidenav-label">{t("nav.routine")}</span>
        </button>
        <div className="sidenav-separator" aria-hidden="true" />
        <button
          className={`sidenav-btn ${route === "mcp" ? "active" : ""}`}
          data-nav="mcp"
          type="button"
          aria-label={t("nav.mcp_label")}
          aria-pressed={route === "mcp"}
          title={t("nav.mcp_label")}
          onClick={() => setRoute((r) => r === "mcp" ? "main" : "mcp")}
          onMouseEnter={(e) => showNavTooltip(t("nav.mcp"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.mcp"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavMcp size={18} />
          <span className="sidenav-label">{t("nav.mcp")}</span>
        </button>
        <button
          className={`sidenav-btn ${route === "skills" ? "active" : ""}`}
          data-nav="skills"
          type="button"
          aria-label={t("nav.skills_label")}
          aria-pressed={route === "skills"}
          title={t("nav.skills_label")}
          onClick={() => setRoute((r) => r === "skills" ? "main" : "skills")}
          onMouseEnter={(e) => showNavTooltip(t("nav.skills"), e.currentTarget)}
          onMouseLeave={hideNavTooltip}
          onFocus={(e) => showNavTooltip(t("nav.skills"), e.currentTarget)}
          onBlur={hideNavTooltip}
        >
          <NavSkills size={18} />
          <span className="sidenav-label">{t("nav.skills")}</span>
        </button>
        {isAdmin ? (
          <button
            className={`sidenav-btn ${route === "channels" ? "active" : ""}`}
            data-nav="channels"
            type="button"
            aria-label={t("nav.channels_label")}
            aria-pressed={route === "channels"}
            title={t("nav.channels_label")}
            onClick={() => setRoute((r) => r === "channels" ? "main" : "channels")}
            onMouseEnter={(e) => showNavTooltip(t("nav.channels"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.channels"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavChannels size={18} />
            <span className="sidenav-label">{t("nav.channels")}</span>
          </button>
        ) : null}
        {isAdmin ? (
          <button
            className={`sidenav-btn ${route === "admin" ? "active" : ""}`}
            data-nav="admin"
            type="button"
            aria-label={t("nav.admin_label")}
            aria-pressed={route === "admin"}
            title={t("nav.admin_label")}
            onClick={() => setRoute((r) => r === "admin" ? "main" : "admin")}
            onMouseEnter={(e) => showNavTooltip(t("nav.admin"), e.currentTarget)}
            onMouseLeave={hideNavTooltip}
            onFocus={(e) => showNavTooltip(t("nav.admin"), e.currentTarget)}
            onBlur={hideNavTooltip}
          >
            <NavAdmin size={18} />
            <span className="sidenav-label">{t("nav.admin")}</span>
          </button>
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
