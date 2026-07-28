"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { bootstrapUser, login } from "../../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RelayMark } from "../RelayMark";

interface AdminLoginScreenProps {
  onLogin: () => void;
  needsBootstrap: boolean;
  onSwitchToBootstrap: () => void;
}

interface FirstAdminSetupScreenProps {
  onBootstrapped: () => void;
  onSwitchToLogin: () => void;
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="adm-auth-shell">
      <div className="adm-auth-card">
        <div className="adm-auth-brand">
          <RelayMark width={32} height={32} aria-hidden="true" />
          <span className="sr-only">Relay Admin</span>
        </div>
        {children}
      </div>
    </section>
  );
}

export function AdminLoginScreen({ onLogin, needsBootstrap, onSwitchToBootstrap }: AdminLoginScreenProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login({ username: username.trim(), password });
      onLogin();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message ? t("admin.v2.action_failed", { message }) : t("admin.error_generic"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthShell>
      <header className="adm-auth-head">
        <h1 className="adm-auth-title">{t("admin.login")}</h1>
        <p className="adm-auth-sub">
          {needsBootstrap ? t("admin.no_admins") : t("admin.login_sub")}
        </p>
      </header>
      <form className="adm-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="adm-field">
          <span>{t("admin.username")}</span>
          <Input
            name="username"
            className="code"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            spellCheck={false}
            required
          />
        </label>
        <label className="adm-field">
          <span>{t("admin.password")}</span>
          <Input
            name="password"
            className="code"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <div className="adm-form-error" role="alert">{error}</div> : null}
        <Button
          type="submit"
          className="w-full"
          loading={isLoading}
          loadingLabel={t("admin.signing_in")}
        >
          {t("admin.sign_in")}
        </Button>
        {needsBootstrap ? (
          <Button type="button" variant="ghost" className="w-full" onClick={onSwitchToBootstrap}>
            {t("login.go_bootstrap")}
          </Button>
        ) : null}
      </form>
    </AuthShell>
  );
}

export function FirstAdminSetupScreen({ onBootstrapped, onSwitchToLogin }: FirstAdminSetupScreenProps) {
  const { t } = useTranslation();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await bootstrapUser({ token: token.trim(), username: username.trim(), password });
      onBootstrapped();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message ? t("admin.v2.action_failed", { message }) : t("admin.error_generic"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthShell>
      <header className="adm-auth-head">
        <h1 className="adm-auth-title">{t("admin.bootstrap")}</h1>
        <p className="adm-auth-sub">{t("admin.bootstrap_sub")}</p>
      </header>
      <form className="adm-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="adm-field">
          <span>{t("admin.bootstrap_token")}</span>
          <Input
            name="bootstrap-token"
            className="code"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="adm-field">
          <span>{t("admin.username")}</span>
          <Input
            name="username"
            className="code"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            spellCheck={false}
            required
          />
        </label>
        <label className="adm-field">
          <span>{t("admin.password")}</span>
          <Input
            name="password"
            className="code"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error ? <div className="adm-form-error" role="alert">{error}</div> : null}
        <Button
          type="submit"
          className="w-full"
          loading={isLoading}
          loadingLabel={t("admin.creating")}
        >
          {t("admin.create_admin")}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onSwitchToLogin}>
          {t("login.go_login")}
        </Button>
      </form>
    </AuthShell>
  );
}
