"use client";

import { type ReactNode, type RefObject } from "react";
import {
  ActionAdd,
  AdminChannel,
  AdminConnect,
  AdminDelete,
  AdminEmployees,
  AdminLocked,
  AdminVerified,
  ICON,
} from "../icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  activateChatIntegration,
  addChatAllowedConversation,
  addChatIdentityLink,
  checkChatIntegration,
  createChatIntegration,
  deleteChatAllowedConversation,
  deleteChatIdentityLink,
  listChatIntegrations,
  listControlPanelAgents,
  listControlPanelDaemonNodes,
  rotateTelegramWebhookSecret,
  updateChatIntegration,
} from "../../api";
import type { ChatIntegration, ChatProvider, Tone } from "../../types";
/**
 * Channel presentation primitives, split out of a 1072-line ChannelsView.tsx:
 * the provider glyph and avatar, the status readiness derivation, the create
 * form, and the numbered section wrapper.
 *
 * Every one of these already had an explicit prop interface — they were
 * standalone components sharing a file with the view that renders them, not
 * with anything that reads its state.
 */

/** The credential a Telegram channel needs. Lives here with the form that
 *  renders it and the readiness check that reads it. */
export const TELEGRAM_CREDENTIAL_FIELDS = [
  { key: "botToken", secret: true, labelKey: "admin.v2.chat_field_bot_token" },
] as const;

export function providerLabel(provider: ChatProvider): string {
  return provider[0].toUpperCase() + provider.slice(1);
}

/** Ink-on-neutral provider mark — silhouette carries identity without vendor chroma. */
export function ProviderGlyph({ provider }: { provider: ChatProvider }) {
  if (provider === "telegram") {
    return (
      <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M9.76 14.78 9.5 18.4c.36 0 .52-.15.71-.34l1.7-1.63 3.53 2.6c.65.36 1.11.17 1.28-.6l2.32-10.92h.01c.21-.97-.35-1.35-.98-1.11L4.2 10.54c-.94.37-.92.89-.16 1.13l3.56 1.11 8.27-5.21c.39-.25.74-.11.45.14z"
        />
      </svg>
    );
  }
  return <span>{providerLabel(provider).charAt(0)}</span>;
}

export function ProviderAvatar({ provider, size }: { provider: ChatProvider; size?: "lg" | "hero" }) {
  return (
    <span
      className={`adm-chat-avatar${size ? ` adm-chat-avatar--${size}` : ""}`}
      data-provider={provider}
      aria-hidden="true"
    >
      <ProviderGlyph provider={provider} />
    </span>
  );
}

// Canonical tone semantics (see lib/statusTone.ts): a healthy integration is
// good, a degraded one is warn (queued/impaired), a disabled one is bad
// (unreachable), anything else falls through to neutral.
export function statusTone(status: ChatIntegration["status"]): Tone {
  if (status === "active") return "good";
  if (status === "degraded") return "warn";
  if (status === "disabled") return "bad";
  return "neutral";
}

export function readiness(integration: ChatIntegration): Array<{
  key: string;
  labelKey: string;
  ready: boolean;
  icon: typeof AdminLocked;
}> {
  return [
    ...(integration.provider === "telegram"
      ? [{
          key: "callback",
          labelKey: "admin.v2.chat_readiness_callback",
          ready: typeof integration.config.publicBaseUrl === "string",
          icon: AdminConnect,
        }]
      : []),
    { key: "secrets", labelKey: "admin.v2.chat_readiness_secrets", ready: integration.secretConfigured, icon: AdminLocked },
    { key: "links", labelKey: "admin.v2.chat_readiness_identity", ready: integration.identityLinkCount > 0, icon: AdminEmployees },
    { key: "allowlist", labelKey: "admin.v2.chat_readiness_allowlist", ready: integration.allowedConversationCount > 0, icon: AdminVerified },
  ];
}

export function normalizePublicBaseUrl(value: string): string | undefined {
  if (!value || /\s|\\/.test(value)) return undefined;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || parsed.pathname !== "/"
    ) {
      return undefined;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function ChannelCreateForm({
  displayName,
  tenantId,
  publicBaseUrl,
  credentials,
  busy,
  fieldErrors,
  displayNameRef,
  publicBaseUrlRef,
  credentialRef,
  onDisplayNameChange,
  onTenantIdChange,
  onPublicBaseUrlChange,
  onCredentialChange,
  onSubmit,
  submitLabel,
  onCancel,
  idPrefix = "chat",
}: {
  displayName: string;
  tenantId: string;
  publicBaseUrl: string;
  credentials: Record<string, string>;
  busy: boolean;
  fieldErrors: { displayName?: string; publicBaseUrl?: string; credential?: string };
  displayNameRef: RefObject<HTMLInputElement | null>;
  publicBaseUrlRef: RefObject<HTMLInputElement | null>;
  credentialRef: RefObject<HTMLInputElement | null>;
  onDisplayNameChange: (value: string) => void;
  onTenantIdChange: (value: string) => void;
  onPublicBaseUrlChange: (value: string) => void;
  onCredentialChange: (key: string, value: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  onCancel?: () => void;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  return (
    <form
      className="adm-chat-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      noValidate
    >
      <Field label={t("admin.v2.chat_provider")} wrapper="div">
        <span className="adm-chat-provider-static">Telegram</span>
      </Field>
      <Field
        label={t("admin.v2.chat_display_name")}
        error={fieldErrors.displayName}
        errorId={`${idPrefix}-display-name-error`}
      >
        <Input
          ref={displayNameRef}
          data-modal-initial-focus
          name={`${idPrefix}-display-name`}
          autoComplete="organization"
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          placeholder="Telegram Bot…"
          aria-invalid={Boolean(fieldErrors.displayName) || undefined}
          aria-describedby={fieldErrors.displayName ? `${idPrefix}-display-name-error` : undefined}
        />
      </Field>
      <Field label={t("admin.v2.chat_tenant")} optional={t("admin.v2.optional")}>
        <Input
          name={`${idPrefix}-tenant-id`}
          autoComplete="off"
          spellCheck={false}
          value={tenantId}
          onChange={(event) => onTenantIdChange(event.target.value)}
          placeholder={`${t("admin.v2.optional")}…`}
        />
      </Field>
      <Field
        label={t("admin.v2.chat_public_url")}
        hint={t("admin.v2.chat_public_url_help")}
        error={fieldErrors.publicBaseUrl}
        errorId={`${idPrefix}-public-base-url-error`}
      >
        <Input
          ref={publicBaseUrlRef}
          name={`${idPrefix}-public-base-url`}
          type="url"
          autoComplete="url"
          spellCheck={false}
          value={publicBaseUrl}
          onChange={(event) => onPublicBaseUrlChange(event.target.value)}
          placeholder="https://relay.example.com…"
          aria-invalid={Boolean(fieldErrors.publicBaseUrl) || undefined}
          aria-describedby={fieldErrors.publicBaseUrl ? `${idPrefix}-public-base-url-error` : undefined}
        />
      </Field>
      {TELEGRAM_CREDENTIAL_FIELDS.map((field) => (
        <Field
          key={field.key}
          label={t(field.labelKey)}
          error={fieldErrors.credential}
          errorId={`${idPrefix}-${field.key}-error`}
        >
          <Input
            ref={credentialRef}
            name={`${idPrefix}-${field.key}`}
            autoComplete={field.secret ? "new-password" : "off"}
            spellCheck={false}
            value={credentials[field.key] ?? ""}
            onChange={(event) => onCredentialChange(field.key, event.target.value)}
            type={field.secret ? "password" : "text"}
            placeholder={`${t(field.labelKey)}…`}
            aria-invalid={Boolean(fieldErrors.credential) || undefined}
            aria-describedby={fieldErrors.credential ? `${idPrefix}-${field.key}-error` : undefined}
          />
        </Field>
      ))}
      <small>{t("admin.v2.chat_telegram_secret_generated")}</small>
      {onCancel ? (
        <div className="adm-form-actions">
          <Button size="cta" type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {t("admin.v2.cancel")}
          </Button>
          <Button size="cta" type="submit" loading={busy} loadingLabel={t("admin.creating")}>
            <AdminConnect size={ICON.md} aria-hidden="true" />
            <span>{submitLabel}</span>
          </Button>
        </div>
      ) : (
        <Button type="submit" loading={busy} loadingLabel={t("admin.creating")}>
          <AdminConnect size={ICON.md} aria-hidden="true" />
          <span>{submitLabel}</span>
        </Button>
      )}
    </form>
  );
}

export function ChannelSection({
  title,
  step,
  children,
  className = "",
}: {
  title: string;
  step?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`adm-chat-section ${className}`.trim()}>
      <header className="adm-chat-section-head">
        {step ? <span className="adm-chat-section-step" aria-hidden="true">{step}</span> : null}
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}
