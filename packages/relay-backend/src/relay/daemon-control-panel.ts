import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { REPO_ROOT } from "relay-core";
import type { RelayDaemonResponse } from "./daemon-types.js";
import { jsonResponse } from "./daemon-server.js";

export const CONTROL_PANEL_VERSION = process.env.RELAY_CONTROL_PANEL_VERSION ?? Date.now().toString(36);
export const WEB_UI_PATH = "/web";
export const WEB_UI_DIST_DIR_CANDIDATES = [
  process.env.RELAY_WEB_UI_DIST_DIR,
  resolve(process.cwd(), "packages/relay-web/out"),
  resolve(REPO_ROOT, "packages/relay-web/out"),
].filter((path): path is string => Boolean(path));

export function htmlResponse(status: number, body: string): RelayDaemonResponse {
  return {
    status,
    contentType: "text/html; charset=utf-8",
    body,
  };
}

export function webUiAssetResponse(parts: string[]): RelayDaemonResponse {
  const distDir = webUiDistDir();
  if (!distDir) {
    return htmlResponse(404, "Relay web UI has not been built. Run `npm run build -w relay-web`.\n");
  }
  const requested = parts.length === 0 ? "index.html" : parts.join("/");
  const fallback = requested.endsWith("/") || !extname(requested);
  const assetPath = safeWebUiAssetPath(distDir, fallback ? `${requested.replace(/\/+$/, "")}/index.html` : requested)
    ?? safeWebUiAssetPath(distDir, requested);
  const indexPath = safeWebUiAssetPath(distDir, "index.html");
  const selectedPath = assetPath && existsSync(assetPath) && statSync(assetPath).isFile()
    ? assetPath
    : fallback && indexPath
      ? indexPath
      : undefined;
  if (!selectedPath || !existsSync(selectedPath) || !statSync(selectedPath).isFile()) {
    return jsonResponse(404, { error: "Web UI asset not found." });
  }
  const contentType = contentTypeForPath(selectedPath);
  if (contentType.startsWith("text/") || contentType.startsWith("application/json")) {
    return {
      status: 200,
      contentType,
      body: readFileSync(selectedPath, "utf8"),
    };
  }
  const bytes = readFileSync(selectedPath);
  return {
    status: 200,
    contentType,
    body: bytes.toString("latin1"),
    bodyBytes: bytes,
  };
}

export function webUiDistDir(): string | undefined {
  return WEB_UI_DIST_DIR_CANDIDATES.find((path) => existsSync(path) && statSync(path).isDirectory());
}

export function safeWebUiAssetPath(distDir: string, requested: string): string | undefined {
  const assetPath = resolve(distDir, requested);
  if (assetPath !== distDir && !assetPath.startsWith(`${distDir}/`)) return undefined;
  return assetPath;
}

export function contentTypeForPath(path: string): string {
  const extension = extname(path);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml; charset=utf-8";
  if (extension === ".txt") return "text/plain; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".ico") return "image/x-icon";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".woff") return "font/woff";
  if (extension === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

export function daemonControlPanelHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relay — Control Panel</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
  <style>
    /* =====================================================================
       Relay daemon control panel
       Token vocabulary: docs/design-system.md
       ===================================================================== */

    :root {
      color-scheme: light;

      /* Brand */
      --primary:               #0052ff;
      --primary-active:        #003ecc;
      --primary-disabled:      #a8b8cc;

      /* Text */
      --ink:                   #18232d;
      --body:                  #5b616e;
      --muted:                 #7c828a;
      --muted-soft:            #a8acb3;
      --on-dark:               #ffffff;
      --on-dark-soft:          #a8acb3;

      /* Surfaces */
      --canvas:                #ffffff;
      --surface-soft:          #f7f6f1;
      --surface-strong:        #eef0f3;
      --surface-dark:          #18232d;
      --surface-dark-elevated: #16181c;

      /* Hairlines */
      --hairline:              #dee1e6;
      --hairline-soft:         #eef0f3;

      /* Semantic */
      --semantic-up:           #05b169;
      --semantic-down:         #cf202f;
      --accent-yellow:         #f4b000;

      /* Geometry */
      --r-xs:   4px;
      --r-sm:   8px;
      --r-md:   12px;
      --r-lg:   16px;
      --r-xl:   24px;
      --r-pill: 100px;
      --r-full: 9999px;

      /* Type */
      --font-body: 'Inter', -apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      --font-num:  'JetBrains Mono', ui-monospace, monospace;

      /* Elevation */
      --shadow-lift:    0 4px 12px rgba(0, 0, 0, 0.04);
      --shadow-overlay: 0 12px 32px rgba(24, 35, 45, 0.12);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --canvas:                #0e1318;
        --surface-soft:          #131b22;
        --surface-strong:        #18232d;
        --surface-dark:          #060b10;
        --surface-dark-elevated: #0e1318;
        --hairline:              #1e2c38;
        --hairline-soft:         #162028;
        --ink:                   #e0eaf4;
        --body:                  #7a90a4;
        --muted:                 #546070;
        --muted-soft:            #354050;
        --on-dark:               #e0eaf4;
        --on-dark-soft:          #546070;
      }
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; }

    body {
      min-height: 100vh;
      background: var(--canvas);
      color: var(--ink);
      font-family: var(--font-body);
      font-size: 15px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    ::selection { background: var(--primary); color: var(--on-dark); }

    .mono {
      font-family: var(--font-num);
      font-feature-settings: "tnum" 1;
      font-weight: 500;
      letter-spacing: 0;
    }

    /* ── Top nav ── */

    .top-nav {
      position: sticky;
      top: 0;
      z-index: 10;
      height: 64px;
      padding: 0 40px;
      border-bottom: 1px solid var(--hairline);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--canvas);
      transition: box-shadow 200ms ease;
    }

    .top-nav.scrolled {
      box-shadow: 0 1px 0 var(--hairline), 0 4px 16px rgba(24, 35, 45, 0.06);
    }

    .wordmark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--ink);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .wordmark svg { flex-shrink: 0; }

    .nav-meta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
    }

    .nav-meta .badge {
      padding: 3px 10px;
      border-radius: var(--r-pill);
      background: var(--surface-strong);
      color: var(--ink);
      font-size: 11px;
      font-weight: 600;
    }

    /* ── Dark hero band ── */

    .hero-band {
      background: var(--surface-dark);
      color: var(--on-dark);
      padding: 48px 40px 0;
    }

    .hero-top {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 32px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .hero-left { display: grid; gap: 8px; }

    .eyebrow {
      display: inline-block;
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--on-dark-soft);
    }

    h1 {
      margin: 0;
      font-family: var(--font-body);
      font-weight: 400;
      font-size: 52px;
      line-height: 1.0;
      letter-spacing: -1.3px;
      color: var(--on-dark);
    }

    .refresh {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: var(--r-pill);
      background: transparent;
      color: var(--on-dark-soft);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      white-space: nowrap;
      transition: border-color 140ms ease, color 140ms ease;
    }

    .refresh:hover { border-color: rgba(255, 255, 255, 0.3); color: var(--on-dark); }

    .refresh .dot {
      width: 7px;
      height: 7px;
      border-radius: var(--r-full);
      background: var(--semantic-up);
      box-shadow: 0 0 0 3px rgba(5, 177, 105, 0.2);
      flex: none;
    }

    .refresh.offline .dot {
      background: var(--semantic-down);
      box-shadow: 0 0 0 3px rgba(207, 32, 47, 0.2);
    }

    .refresh.fetching .dot {
      background: transparent;
      border: 1.5px solid var(--primary);
      border-top-color: transparent;
      animation: spin-ring 0.8s linear infinite;
      box-shadow: none;
    }

    /* ── Metrics (inside dark band) ── */

    .metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      padding: 28px 0 0;
    }

    .metric {
      display: grid;
      gap: 6px;
      padding: 0 24px 28px;
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      animation: slide-up 380ms ease-out both;
    }

    .metric:first-child { border-left: 0; padding-left: 0; }

    .metric-label {
      color: var(--on-dark-soft);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }

    .metric-value {
      font-family: var(--font-num);
      font-size: 40px;
      font-weight: 400;
      letter-spacing: -0.02em;
      line-height: 1;
      color: var(--on-dark);
      font-feature-settings: "tnum" 1;
    }

    .metric-value.ready   { color: var(--semantic-up); }
    .metric-value.running { color: var(--primary); }
    .metric-value.failed  { color: var(--semantic-down); }

    /* ── White content area ── */

    main {
      width: min(1280px, calc(100% - 48px));
      margin: 0 auto;
      padding: 40px 0 64px;
    }

    .columns {
      display: grid;
      grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr);
      gap: 28px;
      align-items: start;
    }

    .stack { display: flex; flex-direction: column; gap: 24px; min-width: 0; }

    section.block {
      min-width: 0;
      animation: fade-in 400ms ease-out both;
    }

    .columns > .block        { animation-delay: 280ms; }
    .columns > .stack .block { animation-delay: 340ms; }

    .block-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--ink);
    }

    .block-head h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      line-height: 1.33;
      letter-spacing: 0;
      color: var(--ink);
    }

    .count {
      color: var(--muted);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    /* ── Node table ── */

    .table-card { background: transparent; }

    table { width: 100%; border-collapse: collapse; }

    thead th {
      padding: 6px 12px;
      text-align: left;
      border-bottom: 1px solid var(--hairline);
      color: var(--muted);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    tbody td {
      padding: 14px 12px;
      border-bottom: 1px solid var(--hairline-soft);
      vertical-align: middle;
      font-size: 13px;
      color: var(--ink);
    }

    tbody tr:last-child td { border-bottom: 1px solid var(--hairline); }
    tbody tr { transition: background 120ms ease; }
    tbody tr:hover    { background: var(--surface-soft); }
    tbody tr.selected { background: color-mix(in srgb, var(--primary) 5%, var(--canvas)); }
    tbody tr.node-running > td:first-child { box-shadow: inset 2px 0 0 var(--primary); }

    .col-node   { width: 36%; }
    .col-status { width: 18%; }
    .col-agents { width: 26%; }
    .col-meta   { width: 20%; text-align: right; }

    .node-check {
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }

    .node-check:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 4px;
    }

    .node-name {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: var(--ink);
      line-height: 1.25;
    }

    .node-id {
      display: block;
      margin-top: 3px;
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.06em;
      color: var(--muted);
      word-break: break-all;
      line-height: 1.3;
    }

    .meta-time {
      display: block;
      font-family: var(--font-num);
      font-size: 12px;
      font-weight: 500;
      color: var(--ink);
      line-height: 1.2;
    }

    .meta-sub {
      display: block;
      margin-top: 3px;
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
    }

    /* ── Status pills ── */

    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border: 1px solid var(--hairline);
      border-radius: var(--r-pill);
      background: var(--surface-strong);
      color: var(--muted);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .status::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: var(--r-full);
      background: var(--muted-soft);
      flex: none;
    }

    .status.ready {
      color: var(--semantic-up);
      border-color: color-mix(in srgb, var(--semantic-up) 28%, transparent);
      background: var(--canvas);
    }
    .status.ready::before { background: var(--semantic-up); }

    .status.running,
    .status.provisioning {
      color: var(--primary);
      border-color: color-mix(in srgb, var(--primary) 24%, transparent);
      background: var(--canvas);
    }
    .status.running::before,
    .status.provisioning::before { background: var(--primary); }

    .status.failed,
    .status.stale {
      color: var(--semantic-down);
      border-color: color-mix(in srgb, var(--semantic-down) 28%, transparent);
      background: var(--canvas);
    }
    .status.failed::before,
    .status.stale::before { background: var(--semantic-down); }

    .status.running::before {
      animation: pulse 1.6s ease-in-out infinite;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent);
    }

    /* ── Agent chips ── */

    .agents { display: flex; flex-wrap: wrap; gap: 6px; }

    .agent {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border: 1px solid var(--hairline);
      border-radius: var(--r-pill);
      background: transparent;
      color: var(--muted);
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .agent::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: var(--r-full);
      background: var(--muted-soft);
      flex: none;
    }

    .agent.ready  { color: var(--ink); border-color: var(--hairline); }
    .agent.ready::before  { background: var(--semantic-up); }
    .agent.failed { color: var(--semantic-down); border-color: color-mix(in srgb, var(--semantic-down) 28%, transparent); }
    .agent.failed::before { background: var(--semantic-down); }

    /* ── Feature cards ── */

    .card-grid { display: flex; flex-direction: column; gap: 0; }

    .feature-card {
      padding: 14px 16px;
      border: 1px solid var(--hairline);
      border-bottom: 0;
      background: var(--canvas);
      transition: background 120ms ease;
      animation: slide-up 300ms ease-out both;
    }

    .feature-card:first-child  { border-radius: var(--r-xl) var(--r-xl) 0 0; }
    .feature-card:last-child   { border-bottom: 1px solid var(--hairline); border-radius: 0 0 var(--r-xl) var(--r-xl); }
    .feature-card:only-child   { border-bottom: 1px solid var(--hairline); border-radius: var(--r-xl); }
    .feature-card:hover        { background: var(--surface-soft); }

    .feature-card .row-title {
      margin: 0 0 4px;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.25;
      color: var(--ink);
    }

    .feature-card .row-meta {
      margin: 0 0 6px;
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.1em;
      color: var(--muted);
      word-break: break-all;
      line-height: 1.4;
      text-transform: uppercase;
    }

    .feature-card .row-body {
      margin: 0;
      color: var(--body);
      font-size: 13px;
      line-height: 1.5;
    }

    .empty {
      padding: 24px;
      border: 1px dashed var(--hairline);
      border-radius: var(--r-xl);
      color: var(--muted);
      font-size: 14px;
      text-align: center;
    }

    /* ── Token display ── */

    .token-block[hidden] { display: none; }

    .token-panel {
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--hairline);
      border-radius: var(--r-xl);
      background: var(--canvas);
    }

    .token-panel-head {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
    }

    .token-node { display: grid; gap: 4px; min-width: 0; }

    .token-display {
      font-family: var(--font-num);
      font-size: 11px;
      font-weight: 500;
      color: var(--ink);
      word-break: break-all;
      line-height: 1.5;
      padding: 8px 10px;
      border: 1px solid var(--hairline-soft);
      border-radius: var(--r-sm);
      background: var(--surface-soft);
    }

    .token-display.empty {
      color: var(--muted);
      font-style: italic;
    }

    .token-close {
      display: inline-flex;
      align-items: center;
      height: 32px;
      border: 1px solid var(--hairline);
      border-radius: var(--r-pill);
      background: transparent;
      color: var(--muted);
      padding: 0 12px;
      font-family: var(--font-num);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      cursor: pointer;
      transition: border-color 140ms ease, color 140ms ease;
    }

    .token-close:hover { border-color: var(--ink); color: var(--ink); }

    /* ── Animations ── */

    @keyframes slide-up {
      from { opacity: 0; transform: translateY(12px); }
    }

    @keyframes fade-in {
      from { opacity: 0; }
    }

    @keyframes value-flash {
      0%   { color: var(--primary); }
      100% { color: inherit; }
    }

    @keyframes spin-ring {
      to { transform: rotate(360deg); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }

    .metric:nth-child(1) { animation-delay: 60ms; }
    .metric:nth-child(2) { animation-delay: 110ms; }
    .metric:nth-child(3) { animation-delay: 160ms; }
    .metric:nth-child(4) { animation-delay: 210ms; }
    .metric:nth-child(5) { animation-delay: 260ms; }

    .metric-value.flash { animation: value-flash 520ms ease-out both; }

    /* ── Responsive ── */

    @media (max-width: 1024px) {
      .columns { grid-template-columns: 1fr; }
      .top-nav { padding: 0 24px; }
      .hero-band { padding: 36px 24px 0; }
      main { width: calc(100% - 32px); }
    }

    @media (max-width: 720px) {
      h1 { font-size: 36px; letter-spacing: -0.5px; }
      .hero-top { flex-direction: column; align-items: flex-start; gap: 12px; padding-bottom: 20px; }
      .metrics { grid-template-columns: repeat(3, 1fr); }
      .metric:nth-child(4),
      .metric:nth-child(5) { border-left: 0; padding-left: 0; }
      .metric-value { font-size: 28px; }
      .top-nav { height: 56px; }
      main { padding: 24px 0 40px; }
      thead { display: none; }
      tbody tr { display: block; padding: 12px 0; border-bottom: 1px solid var(--hairline-soft); }
      tbody tr:last-child { border-bottom: 0; }
      tbody td { display: block; width: auto !important; padding: 4px 0; border: 0; text-align: left !important; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
      }
    }

    :where(button, input):focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 3px;
    }
  </style>
</head>
<body>
  <nav class="top-nav" id="topNav">
    <span class="wordmark">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64" width="36" height="24" role="img" aria-label="Relay" style="shape-rendering:geometricPrecision">
        <title>Relay</title>
        <g fill="none" stroke="var(--ink)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 14 H22 L32 24 H40"/><path d="M10 50 H22 L32 40 H40"/>
        </g>
        <g fill="var(--ink)"><circle cx="10" cy="14" r="4"/><circle cx="10" cy="50" r="4"/></g>
        <g stroke="var(--primary)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <line x1="32" y1="32" x2="76" y2="32"/><polyline points="68,24 80,32 68,40"/>
        </g>
      </svg>
      Relay
    </span>
    <span class="nav-meta"><span class="badge">Daemon</span><span>Control panel</span></span>
  </nav>

  <div class="hero-band">
    <section class="hero-top">
      <div class="hero-left">
        <span class="eyebrow">Node operations</span>
        <h1>Control panel</h1>
      </div>
      <div class="refresh" id="refreshState"><span class="dot" aria-hidden="true"></span>waiting for nodes…</div>
    </section>

    <section class="metrics" aria-label="Daemon node metrics">
      <div class="metric"><span class="metric-label">Nodes</span><span class="metric-value" id="metricTotal">0</span></div>
      <div class="metric"><span class="metric-label">Ready</span><span class="metric-value ready" id="metricReady">0</span></div>
      <div class="metric"><span class="metric-label">Running</span><span class="metric-value running" id="metricRunning">0</span></div>
      <div class="metric"><span class="metric-label">Failed</span><span class="metric-value failed" id="metricFailed">0</span></div>
      <div class="metric"><span class="metric-label">Queued</span><span class="metric-value" id="metricQueued">0</span></div>
    </section>
  </div>

  <main>
    <div class="columns">
      <section class="block">
        <div class="block-head">
          <h2>The roster</h2>
          <span class="count" id="nodeCount">0 nodes</span>
        </div>
        <div class="table-card" id="nodeTable"></div>
      </section>

      <div class="stack">
        <section class="block">
          <div class="block-head">
            <h2>In progress</h2>
            <span class="count" id="runCount">0 running</span>
          </div>
          <div class="card-grid" id="activeRuns"></div>
        </section>

        <section class="block token-block" id="tokenBlock" hidden>
          <div class="block-head">
            <h2>Daemon token</h2>
            <span class="count">Read only</span>
          </div>
          <div class="token-panel">
            <div class="token-panel-head">
              <div class="token-node">
                <span class="node-name" id="tokenNodeName"></span>
                <span class="node-id" id="tokenNodeId"></span>
              </div>
              <button type="button" class="token-close" id="tokenClose">Close</button>
            </div>
            <div id="tokenDisplay" class="token-display empty"></div>
          </div>
        </section>

        <section class="block">
          <div class="block-head">
            <h2>Wants attention</h2>
            <span class="count" id="attentionCount">0 items</span>
          </div>
          <div class="card-grid" id="attention"></div>
        </section>
      </div>
    </div>
  </main>

  <script>
    const controlPanelVersion = ${JSON.stringify(CONTROL_PANEL_VERSION)};
    const staleAfterMs = 15000;
    const quietAfterMs = 10000;
    const els = {
      refreshState: document.getElementById('refreshState'),
      metricTotal: document.getElementById('metricTotal'),
      metricReady: document.getElementById('metricReady'),
      metricRunning: document.getElementById('metricRunning'),
      metricFailed: document.getElementById('metricFailed'),
      metricQueued: document.getElementById('metricQueued'),
      nodeCount: document.getElementById('nodeCount'),
      runCount: document.getElementById('runCount'),
      attentionCount: document.getElementById('attentionCount'),
      nodeTable: document.getElementById('nodeTable'),
      activeRuns: document.getElementById('activeRuns'),
      attention: document.getElementById('attention'),
      tokenBlock: document.getElementById('tokenBlock'),
      tokenNodeName: document.getElementById('tokenNodeName'),
      tokenNodeId: document.getElementById('tokenNodeId'),
      tokenDisplay: document.getElementById('tokenDisplay'),
      tokenClose: document.getElementById('tokenClose')
    };
    let latestNodes = [];
    let selectedTokenNodeId = '';
    let firstRender = true;
    const metricPrev = { total: -1, ready: -1, running: -1, failed: -1, queued: -1 };

    const topNav = document.getElementById('topNav');
    window.addEventListener('scroll', function() {
      topNav.classList.toggle('scrolled', window.scrollY > 4);
    }, { passive: true });

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, function(char) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
      });
    }

    function timeAgo(value) {
      if (!value) return 'never';
      const delta = Date.now() - new Date(value).getTime();
      if (!Number.isFinite(delta)) return 'unknown';
      if (delta < 1000) return 'now';
      if (delta < 60000) return Math.floor(delta / 1000) + 's ago';
      if (delta < 3600000) return Math.floor(delta / 60000) + 'm ago';
      return Math.floor(delta / 3600000) + 'h ago';
    }

    function isStale(node) {
      if (typeof node.stale === 'boolean') return node.stale;
      if (node.online === false) return true;
      if (!node.lastSeenAt) return true;
      return Date.now() - new Date(node.lastSeenAt).getTime() > staleAfterMs;
    }

    function visualStatus(node) {
      return isStale(node) ? 'stale' : node.status;
    }

    function renderAgents(agents) {
      return ['claude', 'pi', 'codex'].map(function(agent) {
        const state = agents && agents[agent] ? agents[agent] : 'unknown';
        return '<span class="agent ' + escapeHtml(state) + '">' + agent + '</span>';
      }).join('');
    }

    function animateCount(el, target, duration) {
      const start = parseInt(el.textContent || '0', 10) || 0;
      if (start === target) return;
      const startTime = performance.now();
      function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(start + (target - start) * eased);
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = target;
      }
      requestAnimationFrame(step);
    }

    function setMetric(el, value, prevKey) {
      const changed = metricPrev[prevKey] !== -1 && metricPrev[prevKey] !== value;
      metricPrev[prevKey] = value;
      if (firstRender) {
        animateCount(el, value, 600);
      } else if (changed) {
        el.classList.remove('flash');
        void el.offsetWidth; // reflow to restart animation
        el.classList.add('flash');
        el.textContent = value;
      } else {
        el.textContent = value;
      }
    }

    function selectedTokenNode() {
      return latestNodes.find(function(node) { return node.id === selectedTokenNodeId; });
    }

    function renderTokenInspector() {
      const node = selectedTokenNode();
      els.tokenBlock.hidden = !node;
      if (!node) return;
      els.tokenNodeName.textContent = node.employeeId || 'unknown employee';
      els.tokenNodeId.textContent = node.id;
      els.tokenDisplay.className = 'token-display' + (node.nodeToken ? '' : ' empty');
      els.tokenDisplay.textContent = node.nodeToken || 'Token unavailable until this node re-registers.';
    }

    function selectTokenNode(nodeId) {
      selectedTokenNodeId = nodeId;
      renderTokenInspector();
    }

    function renderNodes(nodes) {
      if (!nodes.length) {
        els.nodeTable.innerHTML = '<div class="empty">No daemon nodes have registered yet.</div>';
        return;
      }
      const rows = nodes.map(function(node) {
        const state = visualStatus(node);
        const activeCount = isStale(node) ? 0 : (node.activeRuns || []).length;
        const classes = [node.id === selectedTokenNodeId ? 'selected' : '', !isStale(node) && node.status === 'running' ? 'node-running' : ''].filter(Boolean).join(' ');
        const selected = classes ? ' class="' + escapeHtml(classes) + '"' : '';
        const nodeToken = node.nodeToken || 'unavailable';
        const tokenClass = node.nodeToken ? 'node-token' : 'node-token missing';
        return '<tr' + selected + '>' +
          '<td class="col-node"><button type="button" class="node-check" data-node-id="' + escapeHtml(node.id) + '" aria-label="Check token for ' + escapeHtml(node.employeeId) + '"><span class="node-name">' + escapeHtml(node.employeeId) + '</span><span class="node-id">' + escapeHtml(node.id) + '</span><span class="' + tokenClass + '">' + escapeHtml(nodeToken) + '</span></button></td>' +
          '<td class="col-status"><span class="status ' + escapeHtml(state) + '">' + escapeHtml(state) + '</span></td>' +
          '<td class="col-agents"><div class="agents">' + renderAgents(node.agents) + '</div></td>' +
          '<td class="col-meta"><span class="meta-time">' + escapeHtml(timeAgo(node.lastSeenAt)) + '</span><span class="meta-sub">' + escapeHtml(node.queuedCommandCount || 0) + ' queued · ' + escapeHtml(activeCount) + ' active</span></td>' +
        '</tr>';
      }).join('');
      els.nodeTable.innerHTML = '<table>' +
        '<thead><tr>' +
          '<th class="col-node">Node</th>' +
          '<th class="col-status">Status</th>' +
          '<th class="col-agents">Agents</th>' +
          '<th class="col-meta" style="text-align:right">Last seen</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
    }

    function renderRuns(nodes) {
      const runs = nodes.flatMap(function(node) {
        if (isStale(node)) return [];
        return (node.activeRuns || []).map(function(run) {
          return { node: node, run: run };
        });
      });
      els.runCount.textContent = runs.length + ' running';
      if (!runs.length) {
        els.activeRuns.innerHTML = '<div class="empty">Nothing is running right now.</div>';
        return;
      }
      els.activeRuns.innerHTML = runs.map(function(item) {
        return '<div class="feature-card">' +
          '<p class="row-title">' + escapeHtml(item.run.agent) + ' · ' + escapeHtml(item.run.mode) + ' on ' + escapeHtml(item.node.employeeId) + '</p>' +
          '<p class="row-meta">' + escapeHtml(item.run.runId) + ' · started ' + escapeHtml(timeAgo(item.run.startedAt)) + '</p>' +
          '<p class="row-body">' + escapeHtml(item.run.taskGoal) + '</p>' +
        '</div>';
      }).join('');
    }

    function renderAttention(nodes) {
      const items = [];
      nodes.forEach(function(node) {
        if (node.lastError) {
          items.push({ title: node.employeeId + ' · error', body: node.lastError });
        }
        if (isStale(node) && (node.activeRuns || []).length) {
          items.push({ title: node.employeeId + ' · stale run', body: (node.activeRuns || []).length + ' run record is still open, but the daemon node is not polling.' });
        }
        if (Date.now() - new Date(node.lastSeenAt || 0).getTime() > quietAfterMs) {
          items.push({ title: node.employeeId + ' · quiet', body: 'Last seen ' + timeAgo(node.lastSeenAt) + '.' });
        }
      });
      els.attentionCount.textContent = items.length + (items.length === 1 ? ' item' : ' items');
      if (!items.length) {
        els.attention.innerHTML = '<div class="empty">All clear.</div>';
        return;
      }
      els.attention.innerHTML = items.slice(0, 6).map(function(item) {
        return '<div class="feature-card">' +
          '<p class="row-title">' + escapeHtml(item.title) + '</p>' +
          '<p class="row-body">' + escapeHtml(item.body) + '</p>' +
        '</div>';
      }).join('');
    }

    function render(data) {
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      latestNodes = nodes;
      if (selectedTokenNodeId && !selectedTokenNode()) selectedTokenNodeId = '';
      const ready = nodes.filter(function(node) { return visualStatus(node) === 'ready'; }).length;
      const running = nodes.filter(function(node) { return !isStale(node) && node.status === 'running'; }).length;
      const failed = nodes.filter(function(node) { return visualStatus(node) === 'failed' || visualStatus(node) === 'stale'; }).length;
      const queued = nodes.reduce(function(total, node) { return total + (node.queuedCommandCount || 0); }, 0);
      setMetric(els.metricTotal, nodes.length, 'total');
      setMetric(els.metricReady, ready, 'ready');
      setMetric(els.metricRunning, running, 'running');
      setMetric(els.metricFailed, failed, 'failed');
      setMetric(els.metricQueued, queued, 'queued');
      els.nodeCount.textContent = nodes.length + (nodes.length === 1 ? ' node' : ' nodes');
      renderNodes(nodes);
      renderRuns(nodes);
      renderAttention(nodes);
      renderTokenInspector();
      firstRender = false;
    }

    function setRefresh(text, offline) {
      els.refreshState.classList.toggle('offline', !!offline);
      els.refreshState.innerHTML = '<span class="dot" aria-hidden="true"></span>' + escapeHtml(text);
    }

    async function refresh() {
      els.refreshState.classList.add('fetching');
      try {
        const response = await fetch('/cp/daemon-nodes', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        render(await response.json());
        setRefresh('Updated ' + new Date().toLocaleTimeString() + ' · hot reload armed', false);
      } catch (error) {
        setRefresh('Offline · ' + (error && error.message ? error.message : String(error)), true);
      } finally {
        els.refreshState.classList.remove('fetching');
      }
    }

    async function checkForPanelUpdate() {
      try {
        const response = await fetch('/cp/version', { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json();
        if (body && body.version && body.version !== controlPanelVersion) {
          window.location.reload();
        }
      } catch (_error) {
        // The daemon may be restarting during a rebuild. The data poll already reports offline state.
      }
    }

    els.nodeTable.addEventListener('click', function(event) {
      const target = event.target instanceof Element ? event.target.closest('.node-check') : null;
      if (!target) return;
      selectTokenNode(target.getAttribute('data-node-id') || '');
      renderNodes(latestNodes);
    });
    els.tokenClose.addEventListener('click', function() {
      selectedTokenNodeId = '';
      render(latestNodes.length ? { nodes: latestNodes } : { nodes: [] });
    });
    refresh();
    setInterval(refresh, 2000);
    setInterval(checkForPanelUpdate, 1000);
  </script>
</body>
</html>`;
}
