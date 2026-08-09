import { relayApiPath } from "relay-core/api-url";

/**
 * Origin of the Relay backend, when the web UI is not served by it.
 *
 * Relay's default deployment serves the exported web UI from the backend, so
 * every API path is same-origin and this is empty. Hosting the UI separately
 * (Vercel) needs one of two shapes, and this is the seam that selects between
 * them:
 *
 * - **Proxied** — the host rewrites `/api/*` to the backend. Leave
 *   `NEXT_PUBLIC_RELAY_API_ORIGIN` unset; requests stay same-origin and the
 *   session cookie needs no cross-site handling.
 * - **Direct** — the browser calls the backend origin itself. Set
 *   `NEXT_PUBLIC_RELAY_API_ORIGIN`; the backend must then allow this origin in
 *   CORS and issue a cookie the browser will send back to it.
 *
 * Next.js inlines `NEXT_PUBLIC_*` at build time, so this is fixed per build —
 * it is read through a function so tests can reason about the fallbacks rather
 * than a captured constant.
 */
export function apiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_RELAY_API_ORIGIN;
  return typeof configured === "string" ? configured.trim().replace(/\/+$/, "") : "";
}

/** Absolute or same-origin URL for a versioned JSON API resource path. */
export function relayApiEndpoint(path: string): string {
  return `${apiOrigin()}${relayApiPath(path)}`;
}

/**
 * Absolute or same-origin URL for a backend path outside the versioned API,
 * such as the persisted `/profile-images/...` media locators.
 */
export function relayBackendPath(path: string): string {
  return `${apiOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Public backend origin for values a human copies out of the UI — daemon
 * `--backend-url` flags and chat webhook base URLs. These must address the
 * backend even in proxied mode, where the page origin is the web host: a
 * daemon does not go through the web host's rewrites, and a chat provider
 * posting a webhook must reach the backend directly.
 */
export function backendPublicOrigin(fallback = "http://127.0.0.1:8790"): string {
  const configured = apiOrigin();
  if (configured) return configured;
  const publicBackend = process.env.NEXT_PUBLIC_RELAY_BACKEND_ORIGIN;
  if (typeof publicBackend === "string" && publicBackend.trim()) {
    return publicBackend.trim().replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return fallback;
}
