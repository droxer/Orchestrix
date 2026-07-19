export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;

export const SUPPORTED_THEMES = ["light", "dark", "system"] as const;

export const SUPPORTED_LANGUAGES = ["en", "zh-CN", "zh-TW"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export type TokenMap = Record<string, string>;

export const tokenStorageKey = "relay-web.tokens";
export const selectedEmployeeKey = "relay-web.selectedEmployee";
export const themeStorageKey = "relay-web.theme";
export const languageStorageKey = "relay-web.language";

export function readTokens(): TokenMap {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(tokenStorageKey) ?? "null") as TokenMap ?? {}; }
  catch { return {}; }
}

export function writeTokens(tokens: TokenMap): void {
  if (typeof window !== "undefined") localStorage.setItem(tokenStorageKey, JSON.stringify(tokens));
}

export function readTheme(): Theme {
  if (typeof localStorage === "undefined") return "dark";
  const stored = localStorage.getItem(themeStorageKey);
  if (stored === "contrast" || stored === "contrast-dark") {
    localStorage.setItem(themeStorageKey, "system");
    return "system";
  }
  return SUPPORTED_THEMES.includes(stored as Theme) ? stored as Theme : "dark";
}

export function readLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(languageStorageKey);
  return SUPPORTED_LANGUAGES.includes(stored as Language) ? stored as Language : "en";
}

export function writeTheme(theme: Theme): void {
  if (typeof window !== "undefined") localStorage.setItem(themeStorageKey, theme);
}

export function writeLanguage(language: Language): void {
  if (typeof window !== "undefined") localStorage.setItem(languageStorageKey, language);
}

/** Resolve the OS color-scheme preference; defaults to light off-DOM. */
export function systemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? systemTheme() : theme;
}

const THEME_COLOR_BY_THEME: Record<ResolvedTheme, string> = {
  light: "#f7f8f9",
  dark: "#101214",
};

export function themeColorForTheme(theme: Theme): string {
  return THEME_COLOR_BY_THEME[resolveTheme(theme)];
}

export function syncThemeColor(theme: Theme): void {
  if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") return;
  const query = typeof document.querySelector === "function" ? document.querySelector.bind(document) : null;
  let meta = query?.('meta[name="theme-color"][data-relay-theme-color]') as HTMLMetaElement | null | undefined;
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("data-relay-theme-color", "");
    document.head.appendChild(meta);
  }
  meta.removeAttribute("media");
  meta.setAttribute("content", themeColorForTheme(theme));
}

/** Reflect the user's choice onto data-theme, resolving "system" to a
 *  concrete value so the CSS needs only html[data-theme] blocks (no
 *  parallel prefers-color-scheme media query). */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  syncThemeColor(theme);
}
