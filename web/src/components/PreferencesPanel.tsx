"use client";

import { useRef, useState, type ComponentType, type KeyboardEvent, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_THEMES,
  type Language,
  type Theme,
} from "../lib/appStorage";
import { PrefAppearance, PrefLanguage } from "./icons";

export type { Language, Theme };
export { SUPPORTED_LANGUAGES, SUPPORTED_THEMES };

const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: "en",    label: "English",            native: "English"   },
  { code: "zh-CN", label: "Simplified Chinese", native: "简体中文"   },
  { code: "zh-TW", label: "Traditional Chinese",native: "繁體中文"   },
];

/* Single source of keyboard order for the appearance radiogroup. The cards
   render in two visual groups (base themes / high-contrast variants) but
   stay ONE radiogroup, so roving-tabindex must walk the whole list in
   reading order. */
const THEME_VALUES: Theme[] = ["light", "dark", "system", "contrast", "contrast-dark"];
const BASE_THEMES: Theme[] = ["light", "dark", "system"];
const CONTRAST_THEMES: Theme[] = ["contrast", "contrast-dark"];
const LANGUAGE_VALUES: Language[] = LANGUAGES.map((l) => l.code);

/* Roving-tabindex keyboard handling for an ARIA radiogroup: arrows + Home/End
   move the selection and focus together, so the group is one tab stop and the
   checked option is the only one reachable by Tab (WAI-ARIA radio pattern). */
function moveRadioSelection<T>(
  event: KeyboardEvent,
  values: readonly T[],
  current: T,
  refs: MutableRefObject<Map<T, HTMLButtonElement | null>>,
  onChange: (value: T) => void,
): void {
  const index = values.indexOf(current);
  if (index < 0) return;
  let next: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown": next = (index + 1) % values.length; break;
    case "ArrowLeft":
    case "ArrowUp":   next = (index - 1 + values.length) % values.length; break;
    case "Home":      next = 0; break;
    case "End":       next = values.length - 1; break;
    default: return;
  }
  event.preventDefault();
  const value = values[next];
  onChange(value);
  refs.current.get(value)?.focus();
}

/* Settings categories. Adding a new settings area = one entry here plus a
   case in renderSection (and its `pref.<id>` i18n label). The left nav and
   the content panel are both driven by this list. */
type CategoryId = "appearance" | "language";

type IconComponent = ComponentType<{ size?: number }>;

const CATEGORIES: { id: CategoryId; labelKey: string; Icon: IconComponent }[] = [
  { id: "appearance", labelKey: "pref.appearance", Icon: PrefAppearance },
  { id: "language", labelKey: "pref.language", Icon: PrefLanguage },
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

function ThemeCard({
  value,
  selected,
  onSelect,
  registerRef,
}: {
  value: Theme;
  selected: boolean;
  onSelect: (theme: Theme) => void;
  registerRef: (value: Theme, el: HTMLButtonElement | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      ref={(el) => { registerRef(value, el); }}
      type="button"
      role="radio"
      className={`pref-theme-card ${selected ? "selected" : ""}`}
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(value)}
    >
      <div className="pref-theme-preview-wrap">
        <ThemePreview tone={value} />
        {selected && (
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
  const refs = useRef<Map<Theme, HTMLButtonElement | null>>(new Map());
  const registerRef = (value: Theme, el: HTMLButtonElement | null) => { refs.current.set(value, el); };
  const renderCard = (value: Theme) => (
    <ThemeCard
      key={value}
      value={value}
      selected={theme === value}
      onSelect={onThemeChange}
      registerRef={registerRef}
    />
  );
  return (
    <>
      <h4 id={headingId} className="pref-section-label">
        {t("pref.appearance")}
      </h4>
      {/* One radiogroup spans both visual groups; roving-tabindex walks the
          full THEME_VALUES order so keyboard flow matches reading order. */}
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        onKeyDown={(e) => moveRadioSelection(e, THEME_VALUES, theme, refs, onThemeChange)}
      >
        <p className="pref-group-label">{t("pref.theme.group")}</p>
        <div className="pref-theme-grid pref-theme-grid--base">
          {BASE_THEMES.map(renderCard)}
        </div>
        <p className="pref-group-label">{t("pref.theme.contrast_group")}</p>
        <div className="pref-theme-grid pref-theme-grid--contrast">
          {CONTRAST_THEMES.map(renderCard)}
        </div>
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
  const refs = useRef<Map<Language, HTMLButtonElement | null>>(new Map());
  return (
    <>
      <h4 id={headingId} className="pref-section-label">
        {t("pref.language")}
      </h4>
      <div
        className="pref-lang-grid"
        role="radiogroup"
        aria-labelledby={headingId}
        onKeyDown={(e) => moveRadioSelection(e, LANGUAGE_VALUES, language, refs, onLanguageChange)}
      >
        {LANGUAGES.map(({ code, label, native }) => (
          <button
            key={code}
            ref={(el) => { refs.current.set(code, el); }}
            type="button"
            role="radio"
            className={`pref-lang-btn ${language === code ? "selected" : ""}`}
            aria-checked={language === code}
            tabIndex={language === code ? 0 : -1}
            lang={code}
            onClick={() => onLanguageChange(code)}
          >
            <span className="pref-lang-native">{native}</span>
            <span className="pref-lang-meta">
              <span className="pref-lang-label">{label}</span>
              {language === code && (
                <span className="pref-lang-check" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="7" fill="var(--color-primary)" />
                    <path d="M4 7l2 2 4-4" stroke="var(--color-on-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </span>
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
        {CATEGORIES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className={`pref-nav-item ${active === id ? "active" : ""}`}
            aria-current={active === id ? "page" : undefined}
            onClick={() => setActive(id)}
          >
            <Icon size={16} />
            <span className="pref-nav-label">{t(labelKey)}</span>
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
