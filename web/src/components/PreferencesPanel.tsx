"use client";

import { useTranslation } from "react-i18next";

export type Theme = "light" | "dark" | "system";
export const SUPPORTED_LANGUAGES = ["en", "zh-CN", "zh-TW"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: "en",    label: "English",            native: "English"   },
  { code: "zh-CN", label: "Simplified Chinese", native: "简体中文"   },
  { code: "zh-TW", label: "Traditional Chinese",native: "繁體中文"   },
];

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

export interface PreferencesPanelProps {
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

export function PreferencesPanel({
  theme,
  onThemeChange,
  language,
  onLanguageChange,
}: PreferencesPanelProps) {
  const { t } = useTranslation();
  return (
    <>
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
    </>
  );
}
