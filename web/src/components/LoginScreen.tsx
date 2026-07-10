"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { bootstrapUser, getAuthStatus, login, RelayApiError } from "../api";
import type { CurrentUser } from "../types";
import { RelayMark } from "./RelayMark";

interface LoginScreenProps {
  onAuthenticated: (user: CurrentUser) => void;
}

/* Backdrop lane labels are the literal agent identities Relay routes work
   across — product nouns, not copy, so they stay untranslated. */
const AGENT_LANES = ["claude", "pi", "codex", "kimi"] as const;

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

  const canSubmit = isBootstrap
    ? Boolean(bootstrapToken.trim() && username.trim() && password)
    : Boolean(username.trim() && password);
  const submitLabel = isBootstrap ? t("login.create_admin") : t("login.sign_in");
  const kickerLabel = isBootstrap ? t("login.kicker_setup") : t("login.kicker_attach");
  const headlineA = isBootstrap ? t("login.headline_bootstrap_a") : t("login.headline_a");
  const headlineB = isBootstrap ? t("login.headline_bootstrap_b") : t("login.headline_b");
  const lede = isBootstrap ? t("login.lede_bootstrap") : t("login.lede");
  const daemonState = isBootstrap ? "pending" : "ready";
  const daemonLabel = isBootstrap
    ? t("login.system_state_pending")
    : t("login.system_state_ready");

  return (
    <main className="login-screen" data-mode={mode}>
      {/* Ambient backdrop: four agent transit lanes with traveling pulses —
          the control plane at work behind the credential gate. */}
      <div className="login-backdrop" aria-hidden="true">
        {AGENT_LANES.map((agent, index) => (
          <div
            key={agent}
            className="login-lane"
            style={{ "--lane-index": index } as CSSProperties}
          >
            <span className="login-lane-label">{agent}</span>
          </div>
        ))}
      </div>

      <section className="login-column" aria-labelledby="login-headline">
        <header className="login-masthead">
          <span className="login-brand">
            <RelayMark width={26} height={26} />
            <span className="login-wordmark">Relay</span>
          </span>
          <span className="login-kicker">{kickerLabel}</span>
        </header>

        <div className="login-body">
          <h1 id="login-headline" className="login-headline">
            {headlineA} <span className="login-headline-break">{headlineB}</span>
          </h1>
          <p className="login-lede">{lede}</p>

          {/* Handshake block — the plane reporting in while the operator
              types. Rows resolve in sequence on load. */}
          <dl className="login-handshake">
            <div className="login-handshake-row" style={{ "--row-index": 0 } as CSSProperties}>
              <dt className="login-handshake-key">{t("login.system_backend")}</dt>
              <dd className="login-handshake-wire" />
              <dd className="login-handshake-state" data-state="ready">
                {t("login.system_state_ready")}
              </dd>
            </div>
            <div className="login-handshake-row" style={{ "--row-index": 1 } as CSSProperties}>
              <dt className="login-handshake-key">{t("login.system_daemon")}</dt>
              <dd className="login-handshake-wire" />
              <dd className="login-handshake-state" data-state={daemonState}>
                {daemonLabel}
              </dd>
            </div>
            <div className="login-handshake-row" style={{ "--row-index": 2 } as CSSProperties}>
              <dt className="login-handshake-key">{t("login.system_sandbox")}</dt>
              <dd className="login-handshake-wire" />
              <dd className="login-handshake-state" data-state="ready">
                {t("login.system_state_boxlite")}
              </dd>
            </div>
          </dl>

          <form
            className="login-form"
            onSubmit={(event) => void (isBootstrap ? handleBootstrap(event) : handleLogin(event))}
          >
            {isBootstrap && (
              <label className="login-field">
                <span className="login-field-label">{t("login.bootstrap_token")}</span>
                <input
                  className="login-input"
                  name="bootstrap-token"
                  type="password"
                  value={bootstrapToken}
                  onChange={(event) => setBootstrapToken(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            )}
            <label className="login-field">
              <span className="login-field-label">{t("login.username")}</span>
              <input
                className="login-input"
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                spellCheck={false}
              />
            </label>
            <label className="login-field">
              <span className="login-field-label">{t("login.password")}</span>
              <input
                className="login-input"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isBootstrap ? "new-password" : "current-password"}
              />
            </label>

            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="login-submit" disabled={isLoading || !canSubmit}>
              <span>{isLoading ? t("login.loading") : submitLabel}</span>
              <span className="login-submit-arrow" aria-hidden="true">
                →
              </span>
            </button>
          </form>
        </div>

        <footer className="login-foot">
          <button
            type="button"
            className="login-switch"
            onClick={() => switchMode(isBootstrap ? "login" : "bootstrap")}
          >
            {isBootstrap ? t("login.go_login") : t("login.go_bootstrap")}
          </button>
          <span className="login-foot-meta">Relay · {new Date().getFullYear()}</span>
        </footer>
      </section>
    </main>
  );
}
