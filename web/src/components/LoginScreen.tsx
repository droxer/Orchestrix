"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { bootstrapUser, getAuthStatus, login, RelayApiError } from "../api";
import type { CurrentUser } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RelayMark } from "./RelayMark";

interface LoginScreenProps {
  onAuthenticated: (user: CurrentUser) => void;
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"login" | "bootstrap">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isBootstrap = mode === "bootstrap";

  function errorMessage(err: unknown, unauthorizedMessage?: string): string {
    if (err instanceof RelayApiError && err.status === 401 && unauthorizedMessage) {
      return unauthorizedMessage;
    }
    return t("login.error_generic");
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const result = await login({ username: username.trim(), password });
      onAuthenticated(result.user);
    } catch (err) {
      setError(errorMessage(err, t("login.invalid")));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleBootstrap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const status = await getAuthStatus();
      if (!status.requiresBootstrap) {
        setError(t("login.no_bootstrap"));
        setIsLoading(false);
        return;
      }
      const result = await bootstrapUser({
        token: bootstrapToken.trim(),
        username: username.trim(),
        password,
      });
      onAuthenticated(result.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  function switchMode(next: "login" | "bootstrap") {
    setMode(next);
    setError(null);
  }

  const kickerLabel = isBootstrap ? t("login.kicker_setup") : t("login.brand");
  const headlineA = isBootstrap ? t("login.headline_bootstrap_a") : t("login.headline_a");
  const headlineB = isBootstrap ? t("login.headline_bootstrap_b") : t("login.headline_b");
  const lede = isBootstrap ? t("login.lede_bootstrap") : t("login.lede");
  const daemonState = isBootstrap ? "pending" : "ready";
  const daemonLabel = isBootstrap ? t("login.system_state_pending") : t("login.system_state_ready");

  return (
    <main className="login-screen">
      <section className="login-pane" aria-labelledby="login-headline">
        <header className="login-pane-top">
          <div className="login-brand-lockup">
            <RelayMark width={36} height={24} />
            <p className="login-kicker" data-mode={mode}>
              {kickerLabel}
            </p>
          </div>
        </header>

        <div className="login-pane-body">
          <h1 id="login-headline" className="login-headline">
            {headlineA}{" "}
            <span className="login-headline-break">{headlineB}</span>
          </h1>
          <p className="login-lede">{lede}</p>

          {isBootstrap ? (
            <form className="login-form" onSubmit={(event) => void handleBootstrap(event)}>
              <label className="login-field">
                <span className="login-field-label">{t("login.bootstrap_token")}</span>
                <Input
                  name="bootstrap-token"
                  type="password"
                  value={bootstrapToken}
                  onChange={(event) => setBootstrapToken(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="login-field">
                <span className="login-field-label">{t("login.username")}</span>
                <Input
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  spellCheck={false}
                />
              </label>
              <label className="login-field">
                <span className="login-field-label">{t("login.password")}</span>
                <Input
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              {error && <div className="login-error" role="alert">{error}</div>}
              <Button
                type="submit"
                disabled={isLoading || !bootstrapToken.trim() || !username.trim() || !password}
              >
                {isLoading ? t("login.loading") : t("login.create_admin")}
              </Button>
            </form>
          ) : (
            <form className="login-form" onSubmit={(event) => void handleLogin(event)}>
              <label className="login-field">
                <span className="login-field-label">{t("login.username")}</span>
                <Input
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  spellCheck={false}
                />
              </label>
              <label className="login-field">
                <span className="login-field-label">{t("login.password")}</span>
                <Input
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              {error && <div className="login-error" role="alert">{error}</div>}
              <Button
                type="submit"
                disabled={isLoading || !username.trim() || !password}
              >
                {isLoading ? t("login.loading") : t("login.sign_in")}
              </Button>
            </form>
          )}
        </div>

        <footer className="login-pane-bottom">
          <div className="login-toggle">
            <span>
              {isBootstrap ? t("login.go_login") : t("login.go_bootstrap")}
            </span>
            <button
              type="button"
              className="login-toggle-button"
              onClick={() => switchMode(isBootstrap ? "login" : "bootstrap")}
            >
              {isBootstrap ? t("login.sign_in") : t("login.create_admin")}
            </button>
          </div>
          <div className="login-foot">
            <span className="login-foot-brand">
              <RelayMark width={20} height={14} />
              <span>Relay · {new Date().getFullYear()}</span>
            </span>
            <span className="login-foot-mark">control plane</span>
          </div>
        </footer>
      </section>

      <aside className="login-atmosphere" aria-hidden="true">
        <div className="login-atmosphere-top">
          <span>{t("login.system_label")}</span>
        </div>

        <blockquote className="login-pullquote">
          {t("login.pullquote")}
          <footer className="login-pullquote-attribution">
            {t("login.pullquote_attribution")}
          </footer>
        </blockquote>

        <dl className="login-system">
          <div className="login-system-row">
            <dt className="login-system-key">{t("login.system_backend")}</dt>
            <dd className="login-system-sep">·····</dd>
            <dd className="login-system-value" data-state="ready">
              {t("login.system_state_ready")}
            </dd>
          </div>
          <div className="login-system-row">
            <dt className="login-system-key">{t("login.system_daemon")}</dt>
            <dd className="login-system-sep">·····</dd>
            <dd className="login-system-value" data-state={daemonState}>
              {daemonLabel}
            </dd>
          </div>
          <div className="login-system-row">
            <dt className="login-system-key">{t("login.system_sandbox")}</dt>
            <dd className="login-system-sep">·····</dd>
            <dd className="login-system-value">{t("login.system_state_boxlite")}</dd>
          </div>
        </dl>
      </aside>
    </main>
  );
}
