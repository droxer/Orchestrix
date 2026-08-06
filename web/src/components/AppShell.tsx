"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { NavPreferences, NavThreads } from "./icons";
import { PreferencesDialog } from "./PreferencesDialog";
import type { Theme, Language } from "./PreferencesPanel";
import { SideNav } from "./SideNav";
import { ArtifactNavButton } from "./ArtifactNavButton";
import type { AppRoute, MobileView } from "@/lib/viewTypes";
import type { CurrentUser } from "@/types";
import { useRelayStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

const WORK_ROUTE_LABEL_KEYS: Record<Exclude<AppRoute, "main">, string> = {
  backlog: "nav.backlog",
  routine: "nav.routine",
  agents: "nav.agents",
  teams: "nav.teams",
  channels: "nav.channels",
  admin: "nav.admin",
  computer: "nav.computer",
};

export type MobileChatChrome = {
  artifactCount: number;
  onOpenArtifacts: () => void;
};

type AppShellProps = {
  route: AppRoute;
  onNavigateRoute: (route: AppRoute) => void;
  hrefForRoute: (route: AppRoute) => string;
  mobileView: MobileView;
  onMobileViewChange: (view: MobileView) => void;
  sidenavExpanded: boolean;
  setSidenavExpanded: (expanded: boolean) => void;
  prefsOpen: boolean;
  setPrefsOpen: Dispatch<SetStateAction<boolean>>;
  skipLinkHref: string;
  activeThreadLabel: string;
  mobileChatChrome: MobileChatChrome;
  user: CurrentUser;
  onLogout: () => void;
  children: ReactNode;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
};

function PreferencesButton({ prefsOpen, setPrefsOpen }: { prefsOpen: boolean; setPrefsOpen: Dispatch<SetStateAction<boolean>> }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      type="button"
      className={`mobile-settings ${prefsOpen ? "active" : ""}`}
      aria-label={t("nav.preferences")}
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
  activeThreadLabel,
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
      ? t("nav.threads")
      : t(WORK_ROUTE_LABEL_KEYS[route]);
  const isMobileChat = route === "main" && mobileView === "chat";

  return (
    <div className="messenger-shell" data-mobile-view={mobileView} data-route={route} data-sidenav={sidenavExpanded ? "open" : "closed"}>
      <a className="skip-link" href={skipLinkHref}>{t("skip_to_content")}</a>

      <div
        className={`mobile-topbar ${route === "main" ? "mobile-topbar--chat" : "mobile-topbar--route"}`}
      >
        {route === "main" ? (
          isMobileChat ? (
            <>
              <Button
                variant="ghost"
                type="button"
                className="mobile-topbar-back"
                aria-label={t("nav.threads")}
                onClick={() => onMobileViewChange("threads")}
              >
                <NavThreads size={16} />
              </Button>
              <div className="mobile-topbar-chat-title" title={activeThreadLabel}>
                <span className="mobile-topbar-title">{activeThreadLabel}</span>
              </div>
              <div className="mobile-topbar-chat-tools">
                <ArtifactNavButton
                  artifactCount={mobileChatChrome.artifactCount}
                  onOpenArtifacts={mobileChatChrome.onOpenArtifacts}
                />
                <PreferencesButton prefsOpen={prefsOpen} setPrefsOpen={setPrefsOpen} />
              </div>
            </>
          ) : (
            <>
              <Button variant="ghost"
                type="button"
                className={mobileView === "threads" ? "active" : ""}
                aria-label={t("nav.threads")}
                aria-pressed={mobileView === "threads"}
                onClick={() => onMobileViewChange("threads")}
              >
                <NavThreads size={16} /><span>{t("nav.threads")}</span>
              </Button>
              <Button variant="ghost"
                type="button"
                className={mobileView === "chat" ? "active" : ""}
                aria-pressed={mobileView === "chat"}
                onClick={() => onMobileViewChange("chat")}
              >
                <span>{activeThreadLabel}</span>
              </Button>
              <PreferencesButton prefsOpen={prefsOpen} setPrefsOpen={setPrefsOpen} />
            </>
          )
        ) : (
          <>
            <div className="mobile-topbar-route">
              <span className="mobile-topbar-eyebrow">{route === "admin" ? t("nav.admin") : t("nav.mobile_section")}</span>
              <span className="mobile-topbar-title">{mobileRouteTitle}</span>
            </div>
            <PreferencesButton prefsOpen={prefsOpen} setPrefsOpen={setPrefsOpen} />
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

      {/* display:contents (owned by shell.css, .messenger-shell > main) keeps
          the route panels as direct grid items of .messenger-shell while the
          <main> landmark stays a sibling of the SideNav <nav>. */}
      <main>
        {children}
      </main>

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
    </div>
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
