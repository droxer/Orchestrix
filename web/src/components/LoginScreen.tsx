"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { login, RelayApiError } from "../api";
import type { CurrentUser } from "../types";
import { RelayMark } from "./RelayMark";
import { Button } from "./ui/button";
import { NavRefresh } from "./icons";

interface LoginScreenProps {
  onAuthenticated: (user: CurrentUser) => void;
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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

  const canSubmit = Boolean(username.trim() && password);

  return (
    <main className="login-screen" data-mode="login">
      <section className="login-card" aria-labelledby="login-headline">
        <header className="login-brand">
          <RelayMark width={28} height={28} />
          <span className="login-wordmark">Relay</span>
        </header>

        <div className="login-intro">
          <h1 id="login-headline" className="login-headline">
            {t("login.kicker_attach")}
          </h1>
          <p className="login-lede">{t("login.lede")}</p>
        </div>

        <form className="login-form" onSubmit={(event) => void handleLogin(event)}>
          <label className="login-field">
            <span className="login-field-label">{t("login.username")}</span>
            <input
              className="login-input"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
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
              autoComplete="current-password"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </label>

          {error && (
            <p className="login-error" id="login-error" role="alert">
              {error}
            </p>
          )}

          <Button variant="default" type="submit" className="login-submit" disabled={isLoading || !canSubmit}>
            {isLoading ? <NavRefresh size={14} className="spin" aria-hidden="true" /> : null}
            {isLoading ? t("login.loading") : t("login.sign_in")}
          </Button>
        </form>

        <footer className="login-foot">
          <span className="login-foot-meta">Relay · {new Date().getFullYear()}</span>
        </footer>
      </section>
    </main>
  );
}
