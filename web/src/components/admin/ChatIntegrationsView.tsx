"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Link2, LockKeyhole, MessageSquare, ShieldCheck, Trash2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  activateChatIntegration,
  addChatAllowedConversation,
  addChatIdentityLink,
  checkChatIntegration,
  createChatIntegration,
  deleteChatAllowedConversation,
  deleteChatIdentityLink,
  listChatIntegrations,
} from "../../api";
import type { ChatIntegration, ChatProvider } from "../../types";

const CHAT_INTEGRATIONS_KEY = ["admin", "chat-integrations"] as const;
const PROVIDERS: ChatProvider[] = ["discord", "telegram", "lark"];

const secretFieldByProvider: Record<ChatProvider, string> = {
  discord: "botToken",
  telegram: "botToken",
  lark: "appSecret",
};

function providerLabel(provider: ChatProvider): string {
  if (provider === "lark") return "Lark";
  return provider[0].toUpperCase() + provider.slice(1);
}

function ProviderAvatar({ provider, size }: { provider: ChatProvider; size?: "lg" }) {
  return (
    <span className={`adm-chat-avatar${size ? " adm-chat-avatar--lg" : ""}`} data-provider={provider} aria-hidden="true">
      {providerLabel(provider).charAt(0)}
    </span>
  );
}

function statusTone(status: ChatIntegration["status"]): string {
  if (status === "active") return "good";
  if (status === "degraded") return "warn";
  if (status === "disabled") return "bad";
  return "neutral";
}

function readiness(integration: ChatIntegration): Array<{ key: string; labelKey: string; ready: boolean; icon: typeof LockKeyhole }> {
  return [
    { key: "secrets", labelKey: "admin.v2.chat_readiness_secrets", ready: integration.secretConfigured, icon: LockKeyhole },
    { key: "links", labelKey: "admin.v2.chat_readiness_identity", ready: integration.identityLinkCount > 0, icon: Users },
    { key: "allowlist", labelKey: "admin.v2.chat_readiness_allowlist", ready: integration.allowedConversationCount > 0, icon: ShieldCheck },
  ];
}

export function ChatIntegrationsView() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<ChatProvider>("discord");
  const [displayName, setDisplayName] = useState("Engineering Discord");
  const [tenantId, setTenantId] = useState("");
  const [secret, setSecret] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [identityForm, setIdentityForm] = useState({ externalUserId: "", employeeId: "", displayName: "", defaultSandboxId: "" });
  const [conversationForm, setConversationForm] = useState({ conversationId: "", threadId: "", label: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: CHAT_INTEGRATIONS_KEY,
    queryFn: async ({ signal }) => (await listChatIntegrations(signal)).integrations,
  });

  const integrations = query.data ?? [];
  const selected = useMemo(
    () => integrations.find((integration) => integration.id === selectedId) ?? integrations[0] ?? null,
    [integrations, selectedId],
  );

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
    try {
      const result = await action();
      mergeIntegration(result.integration);
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
    const secretKey = secretFieldByProvider[provider];
    await mutate("create", () => createChatIntegration({
      provider,
      displayName: displayName.trim(),
      tenantId: tenantId.trim() || undefined,
      secrets: secret.trim() ? { [secretKey]: secret.trim() } : undefined,
      config: { commandName: "relay" },
    }));
    setSecret("");
  }

  async function handleAddIdentity() {
    if (!selected) return;
    await mutate("identity", () => addChatIdentityLink(selected.id, {
      externalUserId: identityForm.externalUserId,
      employeeId: identityForm.employeeId,
      displayName: identityForm.displayName || undefined,
      defaultSandboxId: identityForm.defaultSandboxId || undefined,
    }));
    setIdentityForm({ externalUserId: "", employeeId: "", displayName: "", defaultSandboxId: "" });
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

  return (
    <div className="adm-view adm-chat">
      <section className="adm-chat-band">
        <div className="adm-chat-intro">
          <span className="adm-eyebrow">{t("admin.v2.chat_eyebrow")}</span>
          <h2>{t("admin.v2.chat_title")}</h2>
          <p>{t("admin.v2.chat_sub")}</p>
        </div>
        <div className="adm-chat-metrics" aria-label={t("admin.v2.chat_metrics_label")}>
          <div><strong className="mono">{integrations.length}</strong><span>{t("admin.v2.chat_metric_integrations")}</span></div>
          <div><strong className="mono">{integrations.filter((item) => item.status === "active").length}</strong><span>{t("admin.v2.chat_metric_active")}</span></div>
          <div><strong className="mono">{integrations.reduce((sum, item) => sum + item.identityLinkCount, 0)}</strong><span>{t("admin.v2.chat_metric_links")}</span></div>
        </div>
      </section>

      {error ? <p className="adm-people-error">{t("admin.v2.action_failed", { message: error })}</p> : null}

      <div className="adm-chat-grid">
        <section className="adm-chat-panel">
          <header className="adm-chat-panel-head">
            <Bot size={18} aria-hidden="true" />
            <div>
              <h3>{t("admin.v2.chat_new_title")}</h3>
              <p>{t("admin.v2.chat_new_sub")}</p>
            </div>
          </header>
          <div className="adm-chat-form">
            <label>
              <span>{t("admin.v2.chat_provider")}</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as ChatProvider)}>
                {PROVIDERS.map((item) => <option key={item} value={item}>{providerLabel(item)}</option>)}
              </select>
            </label>
            <label>
              <span>{t("admin.v2.chat_display_name")}</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Engineering Discord" />
            </label>
            <label>
              <span>{t("admin.v2.chat_tenant")}</span>
              <input value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder={provider === "telegram" ? t("admin.v2.optional") : t("admin.v2.chat_tenant")} />
            </label>
            <label>
              <span>{t("admin.v2.chat_secret")}</span>
              <input value={secret} onChange={(event) => setSecret(event.target.value)} type="password" placeholder={secretFieldByProvider[provider]} />
            </label>
            <Button type="button" onClick={() => void handleCreate()} disabled={busy !== null}>
              <Link2 size={16} aria-hidden="true" />
              <span>{t("admin.v2.chat_create")}</span>
            </Button>
          </div>
        </section>

        <section className="adm-chat-panel adm-chat-panel--list">
          <header className="adm-chat-panel-head">
            <MessageSquare size={18} aria-hidden="true" />
            <div>
              <h3>{t("admin.v2.chat_existing_title")}</h3>
              <p>{query.isLoading ? t("admin.v2.dash_loading") : t("admin.v2.chat_existing_sub")}</p>
            </div>
          </header>
          {integrations.length === 0 ? (
            <p className="adm-empty-body">{t("admin.v2.chat_empty")}</p>
          ) : (
            <div className="adm-chat-integration-list">
              {integrations.map((integration) => {
                const active = selected?.id === integration.id;
                return (
                  <button
                    key={integration.id}
                    type="button"
                    className={`adm-chat-integration ${active ? "active" : ""}`}
                    onClick={() => setSelectedId(integration.id)}
                  >
                    <ProviderAvatar provider={integration.provider} />
                    <span className="adm-chat-integration-main">
                      <strong>{integration.displayName}</strong>
                      <span className="mono">{providerLabel(integration.provider)} {integration.tenantId ? `· ${integration.tenantId}` : ""}</span>
                    </span>
                    <span className={`adm-status-pill tone-${statusTone(integration.status)}`}>{t(`admin.v2.chat_status_${integration.status}`, { defaultValue: integration.status })}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="adm-chat-panel adm-chat-panel--detail">
          {selected ? (
            <>
              <header className="adm-chat-panel-head adm-chat-panel-head--detail">
                <ProviderAvatar provider={selected.provider} size="lg" />
                <div>
                  <h3>{selected.displayName}</h3>
                  <p>{selected.health.message}</p>
                </div>
                <span className={`adm-status-pill tone-${statusTone(selected.status)}`}>{t(`admin.v2.chat_status_${selected.status}`, { defaultValue: selected.status })}</span>
              </header>

              <div className="adm-chat-readiness">
                {readiness(selected).map((item) => {
                  const Icon = item.icon;
                  return (
                    <span key={item.key} className={`adm-chat-ready ${item.ready ? "ready" : ""}`}>
                      <Icon size={14} aria-hidden="true" />
                      <span>{t(item.labelKey)}</span>
                    </span>
                  );
                })}
              </div>

              <div className="adm-chat-actions">
                <Button type="button" variant="secondary" onClick={() => void mutate("check", () => checkChatIntegration(selected.id))} disabled={busy !== null}>
                  {t("admin.v2.chat_check")}
                </Button>
                <Button type="button" onClick={() => void mutate("activate", () => activateChatIntegration(selected.id))} disabled={busy !== null || selected.status === "active"}>
                  {t("admin.v2.chat_activate")}
                </Button>
              </div>

              <div className="adm-chat-split">
                <div>
                  <h4>{t("admin.v2.chat_links_title")}</h4>
                  <div className="adm-chat-form compact">
                    <input value={identityForm.externalUserId} onChange={(event) => setIdentityForm((prev) => ({ ...prev, externalUserId: event.target.value }))} placeholder={t("admin.v2.chat_external_user")} />
                    <input value={identityForm.employeeId} onChange={(event) => setIdentityForm((prev) => ({ ...prev, employeeId: event.target.value }))} placeholder={t("admin.v2.placeholder_employee_id")} />
                    <input value={identityForm.defaultSandboxId} onChange={(event) => setIdentityForm((prev) => ({ ...prev, defaultSandboxId: event.target.value }))} placeholder={t("admin.v2.chat_sandbox_placeholder")} />
                    <Button type="button" variant="secondary" onClick={() => void handleAddIdentity()} disabled={busy !== null}>
                      {t("admin.v2.chat_add_link")}
                    </Button>
                  </div>
                  <ul className="adm-chat-rows">
                    {selected.identityLinks.map((link) => (
                      <li key={link.id}>
                        <span><strong>@{link.employeeId}</strong><small className="mono">{link.externalUserId}</small></span>
                        <button type="button" onClick={() => void mutate("delete-link", () => deleteChatIdentityLink(selected.id, link.id))} aria-label={t("admin.v2.chat_delete_link")}>
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4>{t("admin.v2.chat_allow_title")}</h4>
                  <div className="adm-chat-form compact">
                    <input value={conversationForm.conversationId} onChange={(event) => setConversationForm((prev) => ({ ...prev, conversationId: event.target.value }))} placeholder={t("admin.v2.chat_conversation_id")} />
                    <input value={conversationForm.threadId} onChange={(event) => setConversationForm((prev) => ({ ...prev, threadId: event.target.value }))} placeholder={t("admin.v2.chat_thread_optional")} />
                    <input value={conversationForm.label} onChange={(event) => setConversationForm((prev) => ({ ...prev, label: event.target.value }))} placeholder={t("admin.v2.chat_label")} />
                    <Button type="button" variant="secondary" onClick={() => void handleAddConversation()} disabled={busy !== null}>
                      {t("admin.v2.chat_add_allow")}
                    </Button>
                  </div>
                  <ul className="adm-chat-rows">
                    {selected.allowedConversations.map((conversation) => (
                      <li key={conversation.id}>
                        <span><strong>{conversation.label}</strong><small className="mono">{conversation.conversationId}</small></span>
                        <button type="button" onClick={() => void mutate("delete-conversation", () => deleteChatAllowedConversation(selected.id, conversation.id))} aria-label={t("admin.v2.chat_delete_allow")}>
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          ) : (
            <p className="adm-empty-body">{t("admin.v2.chat_select_empty")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
