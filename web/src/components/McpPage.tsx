"use client";

import { useTranslation } from "react-i18next";

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
  return (
    <span className="mcp-transport-badge" data-transport={transport}>
      {transport}
    </span>
  );
}

function StatusDot({ status }: { status: McpServer["status"] }) {
  return (
    <span className="mcp-status-dot" data-status={status} aria-label={status} />
  );
}

function ServerCard({ server }: { server: McpServer }) {
  const { t } = useTranslation();
  return (
    <div className={`mcp-card mcp-card--${server.status}`}>
      <div className="mcp-card-header">
        <div className="mcp-card-title-row">
          <StatusDot status={server.status} />
          <h3 className="mcp-card-name mono">{server.name}</h3>
        </div>
        <TransportBadge transport={server.transport} />
      </div>
      {server.description && (
        <p className="mcp-card-desc">{server.description}</p>
      )}
      <div className="mcp-card-footer">
        {server.command && (
          <span className="mcp-card-command mono">{server.command}</span>
        )}
        {server.toolCount !== undefined && (
          <span className="mcp-tool-count">
            <span className="mcp-tool-count-num mono">{server.toolCount}</span>
            <span className="mcp-tool-count-label">{t("mcp.tools")}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="mcp-empty">
      <div className="mcp-empty-icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect x="8" y="20" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <rect x="32" y="20" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M16 24h16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
          <rect x="18" y="14" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <rect x="18" y="26" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M24 14V10M24 38v-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      <h3 className="mcp-empty-title">{t("mcp.no_servers_title")}</h3>
      <p className="mcp-empty-body">
        {t("mcp.no_servers_body")}
      </p>
      <a
        className="mcp-empty-link"
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
    <section className="mcp-page">
      <header className="mcp-header">
        <div className="mcp-header-title">
          <h1>{t("mcp.title")}</h1>
          <span className="mcp-header-sub mono">{t("mcp.sub")}</span>
        </div>
        {total > 0 && (
          <div className="mcp-header-meta">
            <span className="mcp-header-stat">
              <span className={`mcp-stat-dot ${connected > 0 ? "connected" : ""}`} aria-hidden="true" />
              <span className="mono">{t("mcp.connected_stat", { connected, total })}</span>
            </span>
          </div>
        )}
      </header>

      <div className="mcp-body">
        {total === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="mcp-section-label mono">{t("mcp.configured_servers")}</div>
            <div className="mcp-grid">
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
