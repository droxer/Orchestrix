"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { RelayEmptyState } from "./RelayEmptyState";
import { useAgentInventoryNodes } from "../hooks/useAgentInventory";
import { aggregateMcpByAgent, totalItemCount } from "../lib/agentInventory";
import type { AgentName, DaemonAgentMcpServer, DaemonMcpTransport } from "../types";

// ── Sub-components ────────────────────────────────────────────────────────────

function TransportBadge({ transport }: { transport: DaemonMcpTransport }) {
  const tinted = transport === "sse" || transport === "http";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm border border-hairline px-xs py-[2px] font-mono text-xs font-semibold",
        tinted ? "text-ink" : "text-muted-foreground",
      )}
    >
      {transport}
    </span>
  );
}

function ServerCard({ server }: { server: DaemonAgentMcpServer }) {
  return (
    <div className="flex flex-col gap-sm rounded-md border border-l-[3px] border-hairline border-l-hairline bg-background p-base transition-[box-shadow,border-color] duration-150 hover:shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-sm">
        <h3 className="mono m-0 min-w-0 truncate text-base font-semibold text-ink">{server.name}</h3>
        <TransportBadge transport={server.transport} />
      </div>
      {server.command && (
        <span className="mono mt-auto truncate text-xs text-muted-soft">{server.command}</span>
      )}
    </div>
  );
}

function AgentSection({ agent, servers }: { agent: AgentName; servers: DaemonAgentMcpServer[] }) {
  const { t } = useTranslation();
  return (
    <div className="mb-lg last:mb-0">
      <div className="mb-md flex items-baseline gap-sm">
        <span className="text-base font-semibold text-ink" translate="no">
          {agent}
        </span>
        <span className="mono text-xs font-medium text-muted-foreground">{servers.length}</span>
      </div>
      {servers.length === 0 ? (
        <p className="text-sm text-muted-soft">{t("mcp.agent_empty")}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-base">
          {servers.map((server) => (
            <ServerCard key={server.name} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}

function McpEmptyIllustration() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="8" y="20" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="32" y="20" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 24h16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
      <rect x="18" y="14" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="18" y="26" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M24 14V10M24 38v-4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <RelayEmptyState
      fill
      title={t("mcp.no_servers_title")}
      body={t("mcp.no_servers_body")}
      illustration={<McpEmptyIllustration />}
      actions={(
        <a
          className="relay-empty-link"
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("mcp.learn_more")}
        </a>
      )}
    />
  );
}

// ── McpPage ───────────────────────────────────────────────────────────────────

export function McpPage() {
  const { t } = useTranslation();
  const { nodes } = useAgentInventoryNodes();

  const groups = useMemo(() => aggregateMcpByAgent(nodes), [nodes]);
  const total = totalItemCount(groups);

  return (
    <section className="mcp-page flex min-h-0 flex-col overflow-y-auto bg-background">
      <header className="flex min-h-[var(--header-h)] shrink-0 items-center justify-between gap-base border-b border-hairline px-xl max-[820px]:px-base">
        <div className="flex items-baseline gap-sm">
          <h1 className="m-0 text-lg font-semibold leading-[1.25] text-balance text-ink">{t("mcp.title")}</h1>
          <span className="mono text-xs font-medium text-muted-foreground">{t("mcp.sub")}</span>
        </div>
        {total > 0 && (
          <span className="mono text-xs font-medium text-muted-foreground">{t("mcp.total", { count: total })}</span>
        )}
      </header>

      <div className="flex-1 p-xl max-[820px]:p-base">
        {total === 0 ? (
          <EmptyState />
        ) : (
          groups.map((group) => (
            <AgentSection key={group.agent} agent={group.agent} servers={group.items} />
          ))
        )}
      </div>
    </section>
  );
}
