"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionAdd,
  AdminChannel,
  AdminConnect,
  AdminDelete,
  AdminEmployees,
  AdminLocked,
  AdminVerified,
} from "../icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RelayEmptyState } from "../RelayEmptyState";
import { Drawer } from "./Drawer";
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
  rotateTelegramWebhookSecret,
  updateChatIntegration,
} from "../../api";
import type { ChatIntegration, ChatProvider } from "../../types";

const CHAT_INTEGRATIONS_KEY = ["admin", "chat-integrations"] as const;
const TELEGRAM_CREDENTIAL_FIELDS = [
  { key: "botToken", secret: true, labelKey: "admin.v2.chat_field_bot_token" },
] as const;

function providerLabel(provider: ChatProvider): string {
  return provider[0].toUpperCase() + provider.slice(1);
}

/** Monochrome provider mark — silhouette carries identity without vendor chroma. */
function ProviderGlyph({ provider }: { provider: ChatProvider }) {
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

function ProviderAvatar({ provider, size }: { provider: ChatProvider; size?: "lg" | "hero" }) {
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

function statusTone(status: ChatIntegration["status"]): string {
  if (status === "active") return "good";
  if (status === "degraded") return "warn";
  if (status === "disabled") return "bad";
  return "neutral";
}

function readiness(integration: ChatIntegration): Array<{
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

function ChannelCreateForm({
  displayName,
  tenantId,
  publicBaseUrl,
  credentials,
  busy,
  onDisplayNameChange,
  onTenantIdChange,
  onPublicBaseUrlChange,
  onCredentialChange,
  onSubmit,
  submitLabel,
  idPrefix = "chat",
}: {
  displayName: string;
  tenantId: string;
  publicBaseUrl: string;
  credentials: Record<string, string>;
  busy: boolean;
  onDisplayNameChange: (value: string) => void;
  onTenantIdChange: (value: string) => void;
  onPublicBaseUrlChange: (value: string) => void;
  onCredentialChange: (key: string, value: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="adm-chat-form">
      <label>
        <span>{t("admin.v2.chat_provider")}</span>
        <select name={`${idPrefix}-provider`} defaultValue="telegram">
          <option value="telegram">Telegram</option>
          <option value="discord" disabled>
            {t("admin.v2.chat_provider_coming_soon", { provider: "Discord" })}
          </option>
        </select>
      </label>
      <label>
        <span>{t("admin.v2.chat_display_name")}</span>
        <input
          name={`${idPrefix}-display-name`}
          autoComplete="organization"
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          placeholder="Telegram Bot…"
        />
      </label>
      <label>
        <span>
          {t("admin.v2.chat_tenant")}
          <span className="adm-chat-field-opt">{t("admin.v2.optional")}</span>
        </span>
        <input
          name={`${idPrefix}-tenant-id`}
          autoComplete="off"
          spellCheck={false}
          value={tenantId}
          onChange={(event) => onTenantIdChange(event.target.value)}
          placeholder={`${t("admin.v2.optional")}…`}
        />
      </label>
      <label>
        <span>{t("admin.v2.chat_public_url")}</span>
        <input
          name={`${idPrefix}-public-base-url`}
          autoComplete="url"
          spellCheck={false}
          value={publicBaseUrl}
          onChange={(event) => onPublicBaseUrlChange(event.target.value)}
          placeholder="https://relay.example.com"
        />
        <small>{t("admin.v2.chat_public_url_help")}</small>
      </label>
      {TELEGRAM_CREDENTIAL_FIELDS.map((field) => (
        <label key={field.key}>
          <span>{t(field.labelKey)}</span>
          <input
            name={`${idPrefix}-${field.key}`}
            autoComplete={field.secret ? "new-password" : "off"}
            spellCheck={false}
            value={credentials[field.key] ?? ""}
            onChange={(event) => onCredentialChange(field.key, event.target.value)}
            type={field.secret ? "password" : "text"}
            placeholder={`${t(field.labelKey)}…`}
          />
        </label>
      ))}
      <small>{t("admin.v2.chat_telegram_secret_generated")}</small>
      <Button type="button" onClick={onSubmit} disabled={busy}>
        <AdminConnect size={16} aria-hidden="true" />
        <span>{submitLabel}</span>
      </Button>
    </div>
  );
}

function ChannelSection({
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

export function ChatIntegrationsView({
  createOpen: createOpenProp,
  onCreateOpenChange,
  onHasChannelsChange,
  showToolbarCreate = true,
}: {
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  onHasChannelsChange?: (hasChannels: boolean) => void;
  /** When false, Create lives only in an external header action (Channels route). */
  showToolbarCreate?: boolean;
} = {}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("Telegram Bot");
  const [tenantId, setTenantId] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [editPublicBaseUrl, setEditPublicBaseUrl] = useState("");
  const [editCredentials, setEditCredentials] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [identityForm, setIdentityForm] = useState({
    externalUserId: "",
    employeeId: "",
    displayName: "",
    defaultAgentId: "",
  });
  const [conversationForm, setConversationForm] = useState({
    conversationId: "",
    threadId: "",
    label: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);

  const createControlled = createOpenProp !== undefined;
  const createOpen = createControlled ? Boolean(createOpenProp) : internalCreateOpen;

  function setCreateOpen(open: boolean) {
    if (!createControlled) setInternalCreateOpen(open);
    onCreateOpenChange?.(open);
  }

  const query = useQuery({
    queryKey: CHAT_INTEGRATIONS_KEY,
    queryFn: async ({ signal }) => (await listChatIntegrations(signal)).integrations,
  });
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: ({ signal }) => listControlPanelAgents(undefined, signal),
  });

  const integrations = (query.data ?? []).filter((integration) => integration.provider === "telegram");
  const selected = useMemo(
    () => integrations.find((integration) => integration.id === selectedId) ?? integrations[0] ?? null,
    [integrations, selectedId],
  );
  const hasChannels = integrations.length > 0;
  const activeCount = integrations.filter((integration) => integration.status === "active").length;
  const linkCount = integrations.reduce((sum, integration) => sum + integration.identityLinkCount, 0);

  useEffect(() => {
    onHasChannelsChange?.(hasChannels);
  }, [hasChannels, onHasChannelsChange]);

  useEffect(() => {
    if (!hasChannels && createOpen) {
      if (!createControlled) setInternalCreateOpen(false);
      onCreateOpenChange?.(false);
    }
  }, [hasChannels, createOpen, createControlled, onCreateOpenChange]);

  useEffect(() => {
    if (!selected) return;
    setEditPublicBaseUrl(
      typeof selected.config.publicBaseUrl === "string" ? selected.config.publicBaseUrl : "",
    );
    setEditCredentials(Object.fromEntries(
      TELEGRAM_CREDENTIAL_FIELDS
        .filter((field) => !field.secret)
        .map((field) => {
          const value = selected.config[field.key];
          return [field.key, typeof value === "string" ? value : ""];
        }),
    ));
  }, [selected]);

  function mergeIntegration(updated: ChatIntegration) {
    queryClient.setQueryData<ChatIntegration[]>(CHAT_INTEGRATIONS_KEY, (prev) => {
      const current = prev ?? [];
      return [updated, ...current.filter((integration) => integration.id !== updated.id)];
    });
    setSelectedId(updated.id);
  }

  async function mutate(label: string, action: () => Promise<{ integration: ChatIntegration }>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      mergeIntegration(result.integration);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function provision(
    label: string,
    action: () => Promise<{ integration: ChatIntegration; provisioning: { ok: boolean; message: string } }>,
  ) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      mergeIntegration(result.integration);
      setNotice(result.provisioning.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    if (!displayName.trim()) {
      setError(t("admin.v2.chat_error_name_required"));
      return;
    }
    const normalizedPublicBaseUrl = normalizePublicBaseUrl(publicBaseUrl.trim());
    if (!normalizedPublicBaseUrl) {
      setError(t("admin.v2.chat_error_public_url"));
      return;
    }
    const fields = TELEGRAM_CREDENTIAL_FIELDS;
    const missing = fields.find((field) => !credentials[field.key]?.trim());
    if (missing) {
      setError(t("admin.v2.chat_error_field_required", { field: t(missing.labelKey) }));
      return;
    }
    const config = Object.fromEntries(
      fields.filter((field) => !field.secret).map((field) => [field.key, credentials[field.key].trim()]),
    );
    const secrets = Object.fromEntries(
      fields.filter((field) => field.secret).map((field) => [field.key, credentials[field.key].trim()]),
    );
    await mutate("create", () => createChatIntegration({
      provider: "telegram",
      displayName: displayName.trim(),
      tenantId: tenantId.trim() || undefined,
      secrets,
      config: {
        commandName: "relay",
        ...(normalizedPublicBaseUrl ? { publicBaseUrl: normalizedPublicBaseUrl } : {}),
        ...config,
      },
    }));
    setCredentials({});
    setCreateOpen(false);
  }

  async function handleAddIdentity() {
    if (!selected) return;
    if (!identityForm.externalUserId.trim() || !identityForm.employeeId.trim()) {
      setError(t("admin.v2.chat_identity_required"));
      return;
    }
    await mutate("identity", () => addChatIdentityLink(selected.id, {
      externalUserId: identityForm.externalUserId,
      employeeId: identityForm.employeeId,
      displayName: identityForm.displayName || undefined,
      defaultAgentId: identityForm.defaultAgentId || undefined,
    }));
    setIdentityForm({ externalUserId: "", employeeId: "", displayName: "", defaultAgentId: "" });
  }

  async function handleAddConversation() {
    if (!selected) return;
    await mutate("conversation", () => addChatAllowedConversation(selected.id, {
      conversationId: conversationForm.conversationId,
      threadId: conversationForm.threadId || undefined,
      label: conversationForm.label || undefined,
    }));
    setConversationForm({ conversationId: "", threadId: "", label: "" });
  }

  async function handleUpdateConnection() {
    if (!selected) return;
    const normalizedPublicBaseUrl = normalizePublicBaseUrl(editPublicBaseUrl.trim());
    if (!normalizedPublicBaseUrl) {
      setError(t("admin.v2.chat_error_public_url"));
      return;
    }
    const fields = TELEGRAM_CREDENTIAL_FIELDS;
    const missingPublicField = fields.find((field) => !field.secret && !editCredentials[field.key]?.trim());
    if (missingPublicField) {
      setError(t("admin.v2.chat_error_field_required", { field: t(missingPublicField.labelKey) }));
      return;
    }
    const config = {
      ...selected.config,
      ...(normalizedPublicBaseUrl ? { publicBaseUrl: normalizedPublicBaseUrl } : {}),
      ...Object.fromEntries(
        fields.filter((field) => !field.secret).map((field) => [field.key, editCredentials[field.key].trim()]),
      ),
    };
    const secrets = Object.fromEntries(
      fields
        .filter((field) => field.secret && editCredentials[field.key]?.trim())
        .map((field) => [field.key, editCredentials[field.key].trim()]),
    );
    await mutate("update", () => updateChatIntegration(selected.id, {
      config,
      ...(Object.keys(secrets).length ? { secrets } : {}),
    }));
    setEditCredentials((current) => Object.fromEntries(
      Object.entries(current).map(([key, value]) => [
        key,
        fields.some((field) => field.key === key && field.secret) ? "" : value,
      ]),
    ));
  }

  const createFormProps = {
    displayName,
    tenantId,
    publicBaseUrl,
    credentials,
    busy: busy !== null,
    onDisplayNameChange: setDisplayName,
    onTenantIdChange: setTenantId,
    onPublicBaseUrlChange: setPublicBaseUrl,
    onCredentialChange: (key: string, value: string) =>
      setCredentials((current) => ({ ...current, [key]: value })),
    onSubmit: () => void handleCreate(),
    submitLabel: t("admin.v2.chat_create"),
  };

  const alerts = (
    <>
      {error ? (
        <p className="adm-view-error" role="alert" aria-live="polite">
          {t("admin.v2.action_failed", { message: error })}
        </p>
      ) : null}
      {notice ? (
        <p className="adm-view-notice relay-enter" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {query.error ? (
        <div className="adm-view-error" role="alert">
          <span>{t("admin.v2.chat_load_error")}</span>{" "}
          <Button type="button" size="xs" variant="outline" onClick={() => void query.refetch()}>
            {t("admin.v2.retry")}
          </Button>
        </div>
      ) : null}
    </>
  );

  if (query.isLoading) {
    return (
      <div className="adm-view adm-chat">
        {alerts}
        <p className="adm-empty-body relay-enter">{t("admin.v2.dash_loading")}</p>
      </div>
    );
  }

  if (!query.error && !hasChannels) {
    return (
      <div className="adm-view adm-chat">
        {alerts}
        <div className="adm-chat-stage relay-enter">
          <div className="adm-chat-stage-intro">
            <div className="adm-chat-stage-mark relay-enter relay-enter-delay-1">
              <ProviderAvatar provider="telegram" size="hero" />
            </div>
            <RelayEmptyState
              className="adm-chat-stage-empty"
              title={t("admin.v2.chat_stage_title")}
              body={t("admin.v2.chat_stage_body")}
              animate={false}
              titleId="channels-stage-title"
            />
          </div>
          <div className="adm-chat-stage-form relay-enter relay-enter-delay-3">
            <ChannelCreateForm {...createFormProps} idPrefix="chat" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="adm-view adm-chat">
      {alerts}

      <div className="adm-chat-toolbar relay-enter">
        <div className="adm-chat-metrics" role="group" aria-label={t("admin.v2.chat_metrics_label")}>
          <span className="adm-chat-metric">
            <span className="adm-chat-metric-label">{t("admin.v2.chat_metric_integrations")}</span>
            <strong className="adm-chat-metric-value">{integrations.length}</strong>
          </span>
          <span className="adm-chat-metric">
            <span className="adm-chat-metric-label">{t("admin.v2.chat_metric_active")}</span>
            <strong className="adm-chat-metric-value">{activeCount}</strong>
          </span>
          <span className="adm-chat-metric">
            <span className="adm-chat-metric-label">{t("admin.v2.chat_metric_links")}</span>
            <strong className="adm-chat-metric-value">{linkCount}</strong>
          </span>
        </div>
        {showToolbarCreate ? (
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)} disabled={busy !== null}>
            <ActionAdd size={15} aria-hidden="true" />
            <span>{t("admin.v2.chat_create")}</span>
          </Button>
        ) : null}
      </div>

      <div className="adm-chat-grid">
        <section className="adm-chat-panel adm-chat-panel--list relay-enter relay-enter-delay-1">
          <header className="adm-chat-panel-head">
            <AdminChannel size={18} aria-hidden="true" />
            <div>
              <h2>{t("admin.v2.chat_existing_title")}</h2>
              <p>{t("admin.v2.chat_existing_sub")}</p>
            </div>
          </header>
          <div className="adm-chat-integration-list">
            {integrations.map((integration, index) => {
              const active = selected?.id === integration.id;
              return (
                <Button
                  variant="ghost"
                  key={integration.id}
                  type="button"
                  className={`adm-chat-integration relay-enter relay-enter-delay-${Math.min(index + 2, 5)} ${active ? "active" : ""}`}
                  onClick={() => setSelectedId(integration.id)}
                >
                  <ProviderAvatar provider={integration.provider} />
                  <span className="adm-chat-integration-main">
                    <strong>{integration.displayName}</strong>
                    <span className="mono">
                      {providerLabel(integration.provider)}
                      {integration.tenantId ? ` · ${integration.tenantId}` : ""}
                    </span>
                  </span>
                  <span className={`adm-status-pill tone-${statusTone(integration.status)}`}>
                    {t(`admin.v2.chat_status_${integration.status}`, { defaultValue: integration.status })}
                  </span>
                </Button>
              );
            })}
          </div>
        </section>

        <section className="adm-chat-panel adm-chat-panel--detail relay-enter relay-enter-delay-2">
          {selected ? (
            <>
              <header className="adm-chat-panel-head adm-chat-panel-head--detail">
                <ProviderAvatar provider={selected.provider} size="lg" />
                <div>
                  <h2>{selected.displayName}</h2>
                  <p>{selected.health.message}</p>
                </div>
                <span className={`adm-status-pill tone-${statusTone(selected.status)}`}>
                  {t(`admin.v2.chat_status_${selected.status}`, { defaultValue: selected.status })}
                </span>
              </header>

              <div className="adm-chat-readiness" role="list" aria-label={t("admin.v2.chat_readiness_label")}>
                {readiness(selected).map((item) => {
                  const Icon = item.icon;
                  return (
                    <span
                      key={item.key}
                      role="listitem"
                      className={`adm-chat-ready ${item.ready ? "ready" : ""}`}
                    >
                      <Icon size={14} aria-hidden="true" />
                      <span>{t(item.labelKey)}</span>
                    </span>
                  );
                })}
              </div>

              <ChannelSection title={t("admin.v2.chat_connection_title")} step="1">
                <div className="adm-chat-form compact adm-chat-connection-form">
                  {selected.provider === "telegram" ? (
                    <label>
                      <span>{t("admin.v2.chat_public_url")}</span>
                      <input
                        name="chat-edit-public-base-url"
                        autoComplete="url"
                        spellCheck={false}
                        value={editPublicBaseUrl}
                        onChange={(event) => setEditPublicBaseUrl(event.target.value)}
                      />
                    </label>
                  ) : null}
                  {TELEGRAM_CREDENTIAL_FIELDS.map((field) => (
                    <label key={field.key}>
                      <span>{t(field.labelKey)}</span>
                      <input
                        name={`chat-edit-${field.key}`}
                        autoComplete={field.secret ? "new-password" : "off"}
                        spellCheck={false}
                        type={field.secret ? "password" : "text"}
                        value={editCredentials[field.key] ?? ""}
                        onChange={(event) =>
                          setEditCredentials((current) => ({ ...current, [field.key]: event.target.value }))
                        }
                        placeholder={field.secret ? t("admin.v2.chat_secret_unchanged") : undefined}
                      />
                    </label>
                  ))}
                  <div className="adm-chat-section-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleUpdateConnection()}
                      disabled={busy !== null}
                    >
                      {t("admin.v2.chat_save_connection")}
                    </Button>
                    {selected.provider === "telegram" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void provision("rotate-secret", () => rotateTelegramWebhookSecret(selected.id))}
                        disabled={busy !== null}
                      >
                        {t("admin.v2.chat_rotate_webhook_secret")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </ChannelSection>

              <ChannelSection title={t("admin.v2.chat_live_title")} step="2">
                <div className="adm-chat-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void mutate("check", () => checkChatIntegration(selected.id))}
                    disabled={busy !== null}
                  >
                    {t("admin.v2.chat_check")}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void provision("activate", () => activateChatIntegration(selected.id))}
                    disabled={busy !== null || selected.status === "active"}
                  >
                    {t("admin.v2.chat_activate")}
                  </Button>
                </div>
                {selected.provider === "telegram" && typeof selected.config.publicBaseUrl === "string" ? (
                  <div className="adm-chat-callback">
                    <strong>{t("admin.v2.chat_callback_url")}</strong>
                    <code>
                      {`${String(selected.config.publicBaseUrl).replace(/\/+$/, "")}/webhooks/${selected.provider}/${selected.id}`}
                    </code>
                    <small>{t(`admin.v2.chat_callback_help_${selected.provider}`)}</small>
                  </div>
                ) : null}
              </ChannelSection>

              <div className="adm-chat-split">
                <ChannelSection title={t("admin.v2.chat_links_title")} step="3">
                  <div className="adm-chat-form compact">
                    <input
                      name="chat-external-user-id"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={t("admin.v2.chat_external_user")}
                      value={identityForm.externalUserId}
                      onChange={(event) =>
                        setIdentityForm((prev) => ({ ...prev, externalUserId: event.target.value }))
                      }
                      placeholder={`${t("admin.v2.chat_external_user")}…`}
                    />
                    <input
                      name="chat-employee-id"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={t("admin.v2.placeholder_employee_id")}
                      value={identityForm.employeeId}
                      onChange={(event) =>
                        setIdentityForm((prev) => ({
                          ...prev,
                          employeeId: event.target.value,
                          defaultAgentId: "",
                        }))
                      }
                      placeholder={`${t("admin.v2.placeholder_employee_id")}…`}
                    />
                    <select
                      name="chat-default-agent-id"
                      aria-label={t("admin.v2.chat_agent_placeholder")}
                      value={identityForm.defaultAgentId}
                      onChange={(event) =>
                        setIdentityForm((prev) => ({ ...prev, defaultAgentId: event.target.value }))
                      }
                    >
                      <option value="">{t("admin.v2.chat_agent_placeholder")}</option>
                      {(agentsQuery.data?.agents ?? [])
                        .filter((agent) =>
                          !agent.deletedAt
                          && (!identityForm.employeeId || agent.employeeId === identityForm.employeeId),
                        )
                        .map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.displayName} · {agent.executorKind}
                          </option>
                        ))}
                    </select>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleAddIdentity()}
                      disabled={busy !== null}
                    >
                      {t("admin.v2.chat_add_link")}
                    </Button>
                  </div>
                  <ul className="adm-chat-rows">
                    {selected.identityLinks.map((link) => (
                      <li key={link.id}>
                        <span>
                          <strong>@{link.employeeId}</strong>
                          <small className="mono">{link.externalUserId}</small>
                        </span>
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() =>
                            void mutate("delete-link", () => deleteChatIdentityLink(selected.id, link.id))
                          }
                          aria-label={t("admin.v2.chat_delete_link")}
                        >
                          <AdminDelete size={13} aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </ChannelSection>

                <ChannelSection title={t("admin.v2.chat_allow_title")} step="4">
                  <div className="adm-chat-form compact">
                    <input
                      name="chat-conversation-id"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={t("admin.v2.chat_conversation_id")}
                      value={conversationForm.conversationId}
                      onChange={(event) =>
                        setConversationForm((prev) => ({ ...prev, conversationId: event.target.value }))
                      }
                      placeholder={`${t("admin.v2.chat_conversation_id")}…`}
                    />
                    <input
                      name="chat-thread-id"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={t("admin.v2.chat_thread_optional")}
                      value={conversationForm.threadId}
                      onChange={(event) =>
                        setConversationForm((prev) => ({ ...prev, threadId: event.target.value }))
                      }
                      placeholder={`${t("admin.v2.chat_thread_optional")}…`}
                    />
                    <input
                      name="chat-conversation-label"
                      autoComplete="off"
                      aria-label={t("admin.v2.chat_label")}
                      value={conversationForm.label}
                      onChange={(event) =>
                        setConversationForm((prev) => ({ ...prev, label: event.target.value }))
                      }
                      placeholder={`${t("admin.v2.chat_label")}…`}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleAddConversation()}
                      disabled={busy !== null}
                    >
                      {t("admin.v2.chat_add_allow")}
                    </Button>
                  </div>
                  <ul className="adm-chat-rows">
                    {selected.allowedConversations.map((conversation) => (
                      <li key={conversation.id}>
                        <span>
                          <strong>{conversation.label}</strong>
                          <small className="mono">{conversation.conversationId}</small>
                        </span>
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() =>
                            void mutate(
                              "delete-conversation",
                              () => deleteChatAllowedConversation(selected.id, conversation.id),
                            )
                          }
                          aria-label={t("admin.v2.chat_delete_allow")}
                        >
                          <AdminDelete size={13} aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </ChannelSection>
              </div>
            </>
          ) : (
            <RelayEmptyState
              fill
              title={t("admin.v2.chat_select_empty")}
              body={t("admin.v2.chat_select_empty_body")}
              titleId="channels-select-empty"
            />
          )}
        </section>
      </div>

      <Drawer
        open={createOpen && hasChannels}
        onClose={() => setCreateOpen(false)}
        kicker={t("admin.v2.chat_eyebrow")}
        title={t("admin.v2.chat_new_title")}
        subtitle={t("admin.v2.chat_new_sub")}
        closeLabel={t("admin.v2.close_drawer")}
        ariaLabel={t("admin.v2.chat_new_title")}
        bodyClassName="adm-drawer-body--column"
        width={440}
      >
        <ChannelCreateForm {...createFormProps} idPrefix="chat-drawer" />
      </Drawer>
    </div>
  );
}
