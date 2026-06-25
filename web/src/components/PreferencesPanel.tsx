"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_THEMES,
  type Language,
  type Theme,
} from "../lib/appStorage";

export type { Language, Theme };
export { SUPPORTED_LANGUAGES, SUPPORTED_THEMES };

const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: "en",    label: "English",            native: "English"   },
  { code: "zh-CN", label: "Simplified Chinese", native: "简体中文"   },
  { code: "zh-TW", label: "Traditional Chinese",native: "繁體中文"   },
];

const THEME_OPTIONS: { value: Theme }[] = [
  { value: "light" },
  { value: "dark" },
  { value: "system" },
  { value: "contrast" },
];

/* Settings categories. Adding a new settings area = one entry here plus a
   case in renderSection (and its `pref.<id>` i18n label). The left nav and
   the content panel are both driven by this list. */
type CategoryId = "appearance" | "language";

const CATEGORIES: { id: CategoryId; labelKey: string }[] = [
  { id: "appearance", labelKey: "pref.appearance" },
  { id: "language", labelKey: "pref.language" },
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

function AppearanceSection({
  theme,
  onThemeChange,
  headingId,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  headingId: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h4 id={headingId} className="pref-section-label">
        {t("pref.appearance")}
      </h4>
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
                    <path d="M4 7l2 2 4-4" stroke="var(--color-on-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </div>
            <span className="pref-theme-label">{t(`pref.theme.${value}`)}</span>
            <span className="pref-theme-sub">{t(`pref.theme.${value}_sub`)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function LanguageSection({
  language,
  onLanguageChange,
  headingId,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
  headingId: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h4 id={headingId} className="pref-section-label">
        {t("pref.language")}
      </h4>
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
    </>
  );
}

export interface PreferencesPanelProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
}

export function PreferencesPanel({
  theme,
  onThemeChange,
  language,
  onLanguageChange,
}: PreferencesPanelProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<CategoryId>("appearance");
  const headingId = `pref-section-${active}`;

  return (
    <div className="pref-body">
      <nav className="pref-nav" aria-label={t("pref.title")}>
        {CATEGORIES.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            className={`pref-nav-item ${active === id ? "active" : ""}`}
            aria-current={active === id ? "page" : undefined}
            onClick={() => setActive(id)}
          >
            {t(labelKey)}
          </button>
        ))}
      </nav>

      <div className="pref-content" role="region" aria-labelledby={headingId}>
        {active === "appearance" && (
          <AppearanceSection
            theme={theme}
            onThemeChange={onThemeChange}
            headingId={headingId}
          />
        )}
        {active === "language" && (
          <LanguageSection
            language={language}
            onLanguageChange={onLanguageChange}
            headingId={headingId}
          />
        )}
      </div>
    </div>
  );
}
