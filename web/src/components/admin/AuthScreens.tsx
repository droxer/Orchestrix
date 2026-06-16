"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { bootstrapUser, login } from "../../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LoginScreenProps {
  onLogin: () => void;
  needsBootstrap: boolean;
  onSwitchToBootstrap: () => void;
}

interface BootstrapScreenProps {
  onBootstrapped: () => void;
  onSwitchToLogin: () => void;
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="adm-auth-shell">
      <div className="adm-auth-card">{children}</div>
    </section>
  );
}

export function LoginScreen({ onLogin, needsBootstrap, onSwitchToBootstrap }: LoginScreenProps) {
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
      setError(t("admin.error_generic"));
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
      <form className="adm-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label className="adm-field">
          <span>{t("admin.username")}</span>
          <Input
            name="username"
            className="mono"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            spellCheck={false}
          />
        </label>
        <label className="adm-field">
          <span>{t("admin.password")}</span>
          <Input
            name="password"
            className="mono"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <div className="adm-form-error">{error}</div> : null}
        <Button
          type="submit"
          className="w-full"
          disabled={isLoading || !username.trim() || !password}
        >
          {isLoading ? t("admin.creating") : t("admin.sign_in")}
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

export function BootstrapScreen({ onBootstrapped, onSwitchToLogin }: BootstrapScreenProps) {
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
      setError(t("admin.error_generic"));
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
      <form className="adm-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label className="adm-field">
          <span>{t("admin.bootstrap_token")}</span>
          <Input
            name="bootstrap-token"
            className="mono"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="adm-field">
          <span>{t("admin.username")}</span>
          <Input
            name="username"
            className="mono"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            spellCheck={false}
          />
        </label>
        <label className="adm-field">
          <span>{t("admin.password")}</span>
          <Input
            name="password"
            className="mono"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error ? <div className="adm-form-error">{error}</div> : null}
        <Button
          type="submit"
          className="w-full"
          disabled={isLoading || !token.trim() || !username.trim() || !password}
        >
          {isLoading ? t("admin.creating") : t("admin.create_admin")}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onSwitchToLogin}>
          {t("login.go_login")}
        </Button>
      </form>
    </AuthShell>
  );
}
