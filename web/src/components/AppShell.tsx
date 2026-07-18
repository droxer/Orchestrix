"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { NavConversations, NavPreferences, NavRefresh, StreamAttachment } from "./icons";
import { PreferencesDialog } from "./PreferencesDialog";
import type { Theme, Language } from "./PreferencesPanel";
import { SideNav } from "./SideNav";
import type { AppRoute, MobileView } from "@/lib/viewTypes";
import type { CurrentUser } from "@/types";
import { useRelayStore } from "@/lib/store";
import { Button } from "./ui/button";

const WORK_ROUTE_LABEL_KEYS: Record<Exclude<AppRoute, "main">, string> = {
  backlog: "nav.backlog",
  routine: "nav.routine",
  agents: "nav.agents",
  channels: "nav.channels",
  admin: "nav.admin",
};

export type MobileChatChrome = {
  artifactCount: number;
  hasSession: boolean;
  isRefreshing: boolean;
  onOpenArtifacts: () => void;
  onRefresh: () => void;
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
  mobileChatChrome: MobileChatChrome;
  user: CurrentUser;
  onLogout: () => void;
  children: ReactNode;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
};

function MobileSettingsButton({ prefsOpen, setPrefsOpen }: { prefsOpen: boolean; setPrefsOpen: Dispatch<SetStateAction<boolean>> }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      type="button"
      className={`mobile-settings ${prefsOpen ? "active" : ""}`}
      aria-label={t("nav.settings")}
      aria-haspopup="dialog"
      aria-expanded={prefsOpen}
      onClick={() => setPrefsOpen((v) => !v)}
    >
      <NavPreferences size={16} />
    </Button>
  );
}

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
  mobileChatChrome,
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
  const isMobileChat = route === "main" && mobileView === "chat";

  return (
    <main className="messenger-shell" data-mobile-view={mobileView} data-route={route} data-sidenav={sidenavExpanded ? "open" : "closed"}>
      <a className="skip-link" href={skipLinkHref}>{t("skip_to_content")}</a>

      <div
        className={`mobile-topbar ${route === "main" ? "mobile-topbar--chat" : "mobile-topbar--route"}`}
        aria-label={route === "main" ? t("nav.conversations") : t(WORK_ROUTE_LABEL_KEYS[route])}
      >
        {route === "main" ? (
          isMobileChat ? (
            <>
              <Button
                variant="ghost"
                type="button"
                className="mobile-topbar-back"
                aria-label={t("nav.conversations")}
                onClick={() => onMobileViewChange("threads")}
              >
                <NavConversations size={16} />
              </Button>
              <div className="mobile-topbar-chat-title" title={activeConversationLabel}>
                <span className="mobile-topbar-title">{activeConversationLabel}</span>
              </div>
              <div className="mobile-topbar-chat-tools">
                <Button
                  variant="ghost"
                  className="icon-button"
                  type="button"
                  aria-label={t("artifact.open_drawer")}
                  title={t("artifact.open_drawer")}
                  disabled={!mobileChatChrome.hasSession}
                  onClick={mobileChatChrome.onOpenArtifacts}
                >
                  <StreamAttachment size={16} />
                  {mobileChatChrome.artifactCount > 0 ? (
                    <span className="chat-artifacts-count mono" aria-label={t("artifact.drawer_subtitle", { count: mobileChatChrome.artifactCount })}>
                      {mobileChatChrome.artifactCount}
                    </span>
                  ) : null}
                </Button>
                <Button
                  variant="ghost"
                  className="icon-button"
                  type="button"
                  aria-label={t("nav.refresh")}
                  title={t("nav.refresh")}
                  onClick={mobileChatChrome.onRefresh}
                >
                  <NavRefresh size={16} className={mobileChatChrome.isRefreshing ? "spin" : ""} />
                </Button>
                <MobileSettingsButton prefsOpen={prefsOpen} setPrefsOpen={setPrefsOpen} />
              </div>
            </>
          ) : (
            <>
              <Button variant="ghost"
                type="button"
                className={mobileView === "threads" ? "active" : ""}
                aria-label={t("nav.conversations")}
                aria-pressed={mobileView === "threads"}
                onClick={() => onMobileViewChange("threads")}
              >
                <NavConversations size={16} /><span>{t("nav.chats")}</span>
              </Button>
              <Button variant="ghost"
                type="button"
                className={mobileView === "chat" ? "active" : ""}
                aria-pressed={mobileView === "chat"}
                onClick={() => onMobileViewChange("chat")}
              >
                <span>{activeConversationLabel}</span>
              </Button>
              <MobileSettingsButton prefsOpen={prefsOpen} setPrefsOpen={setPrefsOpen} />
            </>
          )
        ) : (
          <>
            <div className="mobile-topbar-route">
              <span className="mobile-topbar-eyebrow">{route === "admin" ? t("nav.admin") : t("nav.mobile_section")}</span>
              <span className="mobile-topbar-title">{mobileRouteTitle}</span>
            </div>
            <MobileSettingsButton prefsOpen={prefsOpen} setPrefsOpen={setPrefsOpen} />
          </>
        )}
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
