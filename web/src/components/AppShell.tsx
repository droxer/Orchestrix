"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { NavConversations, NavPreferences } from "./icons";
import { PreferencesDialog } from "./PreferencesDialog";
import type { Theme, Language } from "./PreferencesPanel";
import { SideNav } from "./SideNav";
import type { AppRoute, MobileView } from "@/lib/viewTypes";
import type { CurrentUser } from "@/types";
import { useRelayStore } from "@/lib/store";

const WORK_ROUTE_LABEL_KEYS: Record<Exclude<AppRoute, "main">, string> = {
  backlog: "nav.backlog",
  routine: "nav.routine",
  agents: "nav.agents",
  channels: "nav.channels",
  admin: "nav.admin",
};

type AppShellProps = {
  route: AppRoute;
  onNavigateRoute: (route: AppRoute) => void;
  hrefForRoute: (route: AppRoute) => string;
  mobileView: MobileView;
  onMobileViewChange: (view: MobileView) => void;
  sidenavExpanded: boolean;
  setSidenavExpanded: Dispatch<SetStateAction<boolean>>;
  prefsOpen: boolean;
  setPrefsOpen: Dispatch<SetStateAction<boolean>>;
  skipLinkHref: string;
  activeConversationLabel: string;
  user: CurrentUser;
  onLogout: () => void;
  children: ReactNode;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
};

export function AppShell({
  route,
  onNavigateRoute,
  hrefForRoute,
  mobileView,
  onMobileViewChange,
  sidenavExpanded,
  setSidenavExpanded,
  prefsOpen,
  setPrefsOpen,
  skipLinkHref,
  activeConversationLabel,
  user,
  onLogout,
  children,
  theme,
  onThemeChange,
  language,
  onLanguageChange,
}: AppShellProps) {
  const { t } = useTranslation();
  const adminView = useRelayStore((state) => state.adminView);
  const mobileRouteTitle = route === "admin"
    ? t(`admin.v2.title_${adminView}`)
    : route === "main"
      ? t("nav.conversations")
      : t(WORK_ROUTE_LABEL_KEYS[route]);

  return (
    <main className="messenger-shell" data-mobile-view={mobileView} data-route={route} data-sidenav={sidenavExpanded ? "open" : "closed"}>
      <a className="skip-link" href={skipLinkHref}>{t("skip_to_content")}</a>

      <div
        className={`mobile-topbar ${route === "main" ? "mobile-topbar--chat" : "mobile-topbar--route"}`}
        aria-label={route === "main" ? t("nav.conversations") : t(WORK_ROUTE_LABEL_KEYS[route])}
      >
        {route === "main" ? (
          <>
            <button
              type="button"
              className={mobileView === "threads" ? "active" : ""}
              aria-label={t("nav.conversations")}
              aria-pressed={mobileView === "threads"}
              onClick={() => onMobileViewChange("threads")}
            >
              <NavConversations size={16} /><span>{t("nav.chats")}</span>
            </button>
            <button
              type="button"
              className={mobileView === "chat" ? "active" : ""}
              aria-pressed={mobileView === "chat"}
              onClick={() => onMobileViewChange("chat")}
            >
              <span>{activeConversationLabel}</span>
            </button>
          </>
        ) : (
          <div className="mobile-topbar-route">
            <span className="mobile-topbar-eyebrow">{route === "admin" ? t("nav.admin") : t("nav.mobile_section")}</span>
            <span className="mobile-topbar-title">{mobileRouteTitle}</span>
          </div>
        )}
        <button type="button" className={`mobile-settings ${prefsOpen ? "active" : ""}`} aria-label={t("nav.settings")} aria-haspopup="dialog" aria-expanded={prefsOpen} onClick={() => setPrefsOpen((v) => !v)}>
          <NavPreferences size={16} />
        </button>
      </div>

      <SideNav
        sidenavExpanded={sidenavExpanded}
        setSidenavExpanded={setSidenavExpanded}
        route={route}
        onNavigateRoute={onNavigateRoute}
        hrefForRoute={hrefForRoute}
        isAdmin={user.role === "admin"}
        prefsOpen={prefsOpen}
        setPrefsOpen={setPrefsOpen}
        onLogout={onLogout}
      />

      {children}

      <PreferencesDialog
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        preferences={{
          theme,
          onThemeChange,
          language,
          onLanguageChange,
        }}
      />
    </main>
  );
}

export function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="route-loading" role="status" aria-live="polite">
      {t("admin.loading")}
    </div>
  );
}
