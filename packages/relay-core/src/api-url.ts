export const RELAY_API_VERSION = "v1" as const;
export const RELAY_API_PREFIX = `/api/${RELAY_API_VERSION}` as const;

function resourcePath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Build a same-origin Relay JSON API path from a version-relative resource path. */
export function relayApiPath(pathname: string): string {
  const path = resourcePath(pathname);
  if (path === RELAY_API_PREFIX || path.startsWith(`${RELAY_API_PREFIX}/`)) return path;
  return `${RELAY_API_PREFIX}${path}`;
}

/** Build an absolute Relay JSON API URL without duplicating slashes or the API prefix. */
export function relayApiUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${relayApiPath(pathname)}`;
}
