"use client";

import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export type Theme = "light" | "dark" | "system";
export const SUPPORTED_LANGUAGES = ["en", "zh-CN", "zh-TW"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: "en",    label: "English",            native: "English"   },
  { code: "zh-CN", label: "Simplified Chinese", native: "简体中文"   },
  { code: "zh-TW", label: "Traditional Chinese",native: "繁體中文"   },
];

// ── Mini theme previews ───────────────────────────────────────────────────────

function ThemePreview({ tone }: { tone: Theme }) {
  return (
    <div className="pref-theme-preview" data-preview={tone} aria-hidden="true">
      <span className="pref-preview-rail">
        <span />
        <span />
        <span />
      </span>
      <span className="pref-preview-list">
        <span />
        <span />
        <span />
      </span>
      <span className="pref-preview-chat">
        <span />
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

// ── PreferencesModal ──────────────────────────────────────────────────────────

export interface PreferencesDrawerProps {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
}

const THEME_OPTIONS: { value: Theme }[] = [
  { value: "light" },
  { value: "dark" },
  { value: "system" },
];

export function PreferencesDrawer({
  open,
  onClose,
  theme,
  onThemeChange,
  language,
  onLanguageChange,
}: PreferencesDrawerProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      dialogRef.current?.focus();
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="pref-backdrop"
      aria-modal="true"
      role="dialog"
      aria-labelledby="pref-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="pref-modal"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="pref-header">
          <div className="pref-header-text">
            <h3 id="pref-title">{t("pref.title")}</h3>
            <span className="pref-header-sub mono">{t("pref.sub")}</span>
          </div>
          <button type="button" className="pref-close icon-button" aria-label={t("pref.close")} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Appearance ──────────────────────────────────────────────────── */}
        <section className="pref-section">
          <div className="pref-section-label">{t("pref.appearance")}</div>
          <div className="pref-theme-grid">
            {THEME_OPTIONS.map(({ value }) => (
              <button
                key={value}
                type="button"
                className={`pref-theme-card ${theme === value ? "selected" : ""}`}
                aria-pressed={theme === value}
                onClick={() => onThemeChange(value)}
              >
                <div className="pref-theme-preview-wrap">
                  <ThemePreview tone={value} />
                  {theme === value && (
                    <span className="pref-theme-check" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="7" r="7" fill="var(--color-primary)" />
                        <path d="M4 7l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </div>
                <span className="pref-theme-label">{t(`pref.theme.${value}`)}</span>
                <span className="pref-theme-sub">{t(`pref.theme.${value}_sub`)}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Language ────────────────────────────────────────────────────── */}
        <section className="pref-section">
          <div className="pref-section-label">{t("pref.language")}</div>
          <div className="pref-lang-grid">
            {LANGUAGES.map(({ code, label, native }) => (
              <button
                key={code}
                type="button"
                className={`pref-lang-btn ${language === code ? "selected" : ""}`}
                aria-pressed={language === code}
                lang={code}
                onClick={() => onLanguageChange(code)}
              >
                <span className="pref-lang-native">{native}</span>
                <span className="pref-lang-label">{label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
