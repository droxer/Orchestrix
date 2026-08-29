"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { login, RelayApiError } from "../api";
import type { CurrentUser } from "../types";
import { RelayMark } from "./RelayMark";
import { ICON } from "./icons";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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

  return (
    <main className="login-screen" data-mode="login">
      {/* The double-chevron mark bled huge off the canvas edge — the login
          signature. Pinned to the dark register via --lg-ink: unlike
          RelayMark it must stay dark-register ink whatever theme the
          operator has saved. */}
      <span className="login-bleed" aria-hidden="true">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 64 64"
          fill="none"
          focusable="false"
          shapeRendering="geometricPrecision"
        >
          <g strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 14 L32 32 L12 50" stroke="currentColor" />
            <path d="M32 14 L52 32 L32 50" stroke="currentColor" opacity="0.45" />
          </g>
        </svg>
      </span>
      <section className="login-card" aria-labelledby="login-headline">
        <div className="login-identity">
          <header className="login-brand">
            <RelayMark size={ICON.xl} />
            <span className="login-wordmark">Relay</span>
          </header>

          <div className="login-intro">
            <h1 id="login-headline" className="login-headline">
              {t("login.kicker_attach")}
            </h1>
            <p className="login-lede">{t("login.lede")}</p>
          </div>
        </div>

        <form className="login-form" onSubmit={(event) => void handleLogin(event)}>
          <Field className="login-field" label={t("login.username")}>
            <Input
              className="login-input"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </Field>
          <Field className="login-field" label={t("login.password")}>
            <Input
              className="login-input"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </Field>

          {error && (
            <p className="login-error" id="login-error" role="alert">
              {error}
            </p>
          )}

          <Button variant="default" size="cta" type="submit" className="login-submit w-full" loading={isLoading} loadingLabel={t("login.loading")}>
            {t("login.sign_in")}
          </Button>
        </form>

        <footer className="login-foot">
          <span className="login-foot-meta">Relay · {new Date().getFullYear()}</span>
        </footer>
      </section>
    </main>
  );
}
