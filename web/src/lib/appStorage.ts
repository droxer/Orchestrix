import { SUPPORTED_LANGUAGES, type Theme, type Language } from "../components/PreferencesPanel";

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
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem(themeStorageKey) as Theme | null) ?? "system";
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

/** Reflect the user's choice onto data-theme, resolving "system" to a
 *  concrete value so the CSS needs only a single html[data-theme="dark"]
 *  block (no parallel prefers-color-scheme media query). */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const resolved = theme === "system" ? systemTheme() : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}
