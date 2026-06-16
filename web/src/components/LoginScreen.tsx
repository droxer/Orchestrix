"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { bootstrapUser, getAuthStatus, login, RelayApiError } from "../api";
import type { CurrentUser } from "../types";

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

  return (
    <main className="login-screen">
      <div className="login-card">
        <h1>{t("login.title")}</h1>
        <p className="login-subtitle">{t("login.subtitle")}</p>

        {mode === "login" ? (
          <form onSubmit={(event) => void handleLogin(event)}>
            <label className="login-field">
              <span>{t("login.username")}</span>
              <input
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                spellCheck={false}
              />
            </label>
            <label className="login-field">
              <span>{t("login.password")}</span>
              <input
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button type="submit" disabled={isLoading || !username.trim() || !password}>
              {isLoading ? t("login.loading") : t("login.sign_in")}
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => void handleBootstrap(event)}>
            <p className="login-hint">{t("login.bootstrap_hint")}</p>
            <label className="login-field">
              <span>{t("login.bootstrap_token")}</span>
              <input
                name="bootstrap-token"
                type="password"
                value={bootstrapToken}
                onChange={(event) => setBootstrapToken(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="login-field">
              <span>{t("login.username")}</span>
              <input
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                spellCheck={false}
              />
            </label>
            <label className="login-field">
              <span>{t("login.password")}</span>
              <input
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <button type="submit" disabled={isLoading || !bootstrapToken.trim() || !username.trim() || !password}>
              {isLoading ? t("login.loading") : t("login.create_admin")}
            </button>
          </form>
        )}

        {error && <div className="login-error">{error}</div>}

        <div className="login-toggle">
          {mode === "login" ? (
            <button type="button" className="login-link" onClick={() => setMode("bootstrap")}>
              {t("login.go_bootstrap")}
            </button>
          ) : (
            <button type="button" className="login-link" onClick={() => setMode("login")}>
              {t("login.go_login")}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
