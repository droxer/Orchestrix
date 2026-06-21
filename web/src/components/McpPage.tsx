"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpServer {
  name: string;
  transport: "stdio" | "sse" | "http";
  status: "connected" | "disconnected" | "error";
  toolCount?: number;
  description?: string;
  command?: string;
}

// ── Static sample — replace with API call once /mcp-servers endpoint exists ───
const SAMPLE_SERVERS: McpServer[] = [];

// ── Sub-components ────────────────────────────────────────────────────────────

function TransportBadge({ transport }: { transport: McpServer["transport"] }) {
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

function StatusDot({ status }: { status: McpServer["status"] }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "connected" ? "bg-success" : status === "error" ? "bg-danger" : "bg-muted-soft",
      )}
      data-status={status}
      aria-label={t(`mcp.status_${status}`, { defaultValue: status })}
    />
  );
}

function ServerCard({ server }: { server: McpServer }) {
  const { t } = useTranslation();
  const leftBorder =
    server.status === "connected"
      ? "border-l-success"
      : server.status === "error"
        ? "border-l-danger"
        : "border-l-hairline";
  return (
    <div
      className={cn(
        "flex flex-col gap-sm rounded-md border border-l-[3px] border-hairline bg-background p-base transition-[box-shadow,border-color] duration-150 hover:shadow-[var(--shadow-soft)]",
        leftBorder,
      )}
    >
      <div className="flex items-center justify-between gap-sm">
        <div className="flex min-w-0 items-center gap-xs">
          <StatusDot status={server.status} />
          <h3 className="mono m-0 truncate text-base font-semibold text-ink">{server.name}</h3>
        </div>
        <TransportBadge transport={server.transport} />
      </div>
      {server.description && (
        <p className="m-0 flex-1 text-sm leading-normal text-body">{server.description}</p>
      )}
      <div className="mt-auto flex items-center justify-between gap-sm">
        {server.command && (
          <span className="mono max-w-[160px] truncate text-xs text-muted-soft">{server.command}</span>
        )}
        {server.toolCount !== undefined && (
          <span className="flex shrink-0 items-baseline gap-1">
            <span className="mono text-md font-semibold leading-none text-ink">{server.toolCount}</span>
            <span className="text-xs font-medium text-muted-foreground">{t("mcp.tools")}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center gap-md px-xl py-xxl text-center">
      <div className="mb-xs text-muted-soft" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect x="8" y="20" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <rect x="32" y="20" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M16 24h16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
          <rect x="18" y="14" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <rect x="18" y="26" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M24 14V10M24 38v-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      <h3 className="m-0 text-lg font-semibold text-balance text-ink">{t("mcp.no_servers_title")}</h3>
      <p className="m-0 text-sm leading-loose text-body">
        {t("mcp.no_servers_body")}
      </p>
      <a
        className="mt-xs inline-block text-sm font-medium text-primary no-underline transition-opacity duration-[120ms] hover:opacity-75"
        href="https://modelcontextprotocol.io"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("mcp.learn_more")}
      </a>
    </div>
  );
}

// ── McpPage ───────────────────────────────────────────────────────────────────

export function McpPage() {
  const { t } = useTranslation();
  const servers = SAMPLE_SERVERS;

  const connected = servers.filter((s) => s.status === "connected").length;
  const total = servers.length;

  return (
    <section className="mcp-page flex min-h-0 flex-col overflow-y-auto bg-background">
      <header className="flex min-h-[var(--header-h)] shrink-0 items-center justify-between gap-base border-b border-hairline px-xl max-[820px]:px-base">
        <div className="flex items-baseline gap-sm">
          <h1 className="m-0 text-lg font-semibold leading-[1.25] text-balance text-ink">{t("mcp.title")}</h1>
          <span className="mono text-xs font-medium text-muted-foreground">{t("mcp.sub")}</span>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-sm">
            <span className="flex items-center gap-xs text-sm text-muted-foreground">
              <span
                className={cn("size-[7px] shrink-0 rounded-full", connected > 0 ? "bg-success" : "bg-muted-soft")}
                aria-hidden="true"
              />
              <span className="mono">{t("mcp.connected_stat", { connected, total })}</span>
            </span>
          </div>
        )}
      </header>

      <div className="flex-1 p-xl max-[820px]:p-base">
        {total === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="mono mb-md text-xs font-semibold text-muted-foreground">{t("mcp.configured_servers")}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-base">
              {servers.map((server) => (
                <ServerCard key={server.name} server={server} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
