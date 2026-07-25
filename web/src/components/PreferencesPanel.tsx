"use client";

import { useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_THEMES,
  type Language,
  type Theme,
} from "../lib/appStorage";
import { moveRadioSelection } from "../lib/radioGroupKeyboard";
import { PrefAppearance, PrefLanguage } from "./icons";

export type { Language, Theme };
export { SUPPORTED_LANGUAGES, SUPPORTED_THEMES };

const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: "en",    label: "English",            native: "English"   },
  { code: "zh-CN", label: "Simplified Chinese", native: "简体中文"   },
  { code: "zh-TW", label: "Traditional Chinese",native: "繁體中文"   },
];

const THEME_VALUES: Theme[] = ["light", "dark", "system"];
const LANGUAGE_VALUES: Language[] = LANGUAGES.map((l) => l.code);

/* Settings categories. Adding a new settings area = one entry here plus a
   case in renderSection (and its `pref.<id>` i18n label). The left nav and
   the content panel are both driven by this list. */
type CategoryId = "appearance" | "language";

type IconComponent = ComponentType<{ size?: number }>;

const CATEGORIES: { id: CategoryId; labelKey: string; Icon: IconComponent }[] = [
  { id: "appearance", labelKey: "pref.appearance", Icon: PrefAppearance },
  { id: "language", labelKey: "pref.language", Icon: PrefLanguage },
];

const LANGUAGE_BADGES: Record<Language, string> = {
  en: "EN",
  "zh-CN": "简",
  "zh-TW": "繁",
};

function PrefSelectedCheck() {
  return (
    <span className="pref-option-check" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="7" fill="var(--action)" />
        <path d="M4 7l2 2 4-4" stroke="var(--on-action)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function ThemeSwatch({ tone }: { tone: Theme }) {
  return <span className="pref-theme-swatch" data-tone={tone} aria-hidden="true" />;
}

function LanguageBadge({ code }: { code: Language }) {
  return (
    <span className="pref-lang-badge" lang={code} aria-hidden="true">
      {LANGUAGE_BADGES[code]}
    </span>
  );
}

function ThemeOption({
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
      className={`pref-option-row ${selected ? "selected" : ""}`}
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(value)}
    >
      <ThemeSwatch tone={value} />
      <span className="pref-option-copy">
        <span className="pref-option-label">{t(`pref.theme.${value}`)}</span>
        <span className="pref-option-sub">{t(`pref.theme.${value}_sub`)}</span>
      </span>
      {selected ? <PrefSelectedCheck /> : null}
    </button>
  );
}

function AppearanceSection({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  const { t } = useTranslation();
  const refs = useRef<Map<Theme, HTMLButtonElement | null>>(new Map());
  const registerRef = (value: Theme, el: HTMLButtonElement | null) => { refs.current.set(value, el); };
  return (
    <fieldset className="pref-fieldset">
      <legend className="pref-group-label">{t("pref.theme.group")}</legend>
      <div
        role="radiogroup"
        className="pref-option-list"
        onKeyDown={(e) => moveRadioSelection(e, THEME_VALUES, theme, refs, onThemeChange)}
      >
        {THEME_VALUES.map((value) => (
          <ThemeOption
            key={value}
            value={value}
            selected={theme === value}
            onSelect={onThemeChange}
            registerRef={registerRef}
          />
        ))}
      </div>
    </fieldset>
  );
}

function LanguageOption({
  code,
  label,
  native,
  selected,
  onSelect,
  registerRef,
}: {
  code: Language;
  label: string;
  native: string;
  selected: boolean;
  onSelect: (language: Language) => void;
  registerRef: (code: Language, el: HTMLButtonElement | null) => void;
}) {
  const showSub = native !== label;
  return (
    <button
      ref={(el) => { registerRef(code, el); }}
      type="button"
      role="radio"
      className={`pref-option-row ${selected ? "selected" : ""}`}
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      lang={code}
      onClick={() => onSelect(code)}
    >
      <LanguageBadge code={code} />
      <span className="pref-option-copy">
        <span className="pref-option-label">{native}</span>
        {showSub ? <span className="pref-option-sub">{label}</span> : null}
      </span>
      {selected ? <PrefSelectedCheck /> : null}
    </button>
  );
}

function LanguageSection({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const { t } = useTranslation();
  const refs = useRef<Map<Language, HTMLButtonElement | null>>(new Map());
  const registerRef = (code: Language, el: HTMLButtonElement | null) => { refs.current.set(code, el); };
  return (
    <div
      className="pref-option-list"
      role="radiogroup"
      aria-label={t("pref.language")}
      onKeyDown={(e) => moveRadioSelection(e, LANGUAGE_VALUES, language, refs, onLanguageChange)}
    >
      {LANGUAGES.map(({ code, label, native }) => (
        <LanguageOption
          key={code}
          code={code}
          label={label}
          native={native}
          selected={language === code}
          onSelect={onLanguageChange}
          registerRef={registerRef}
        />
      ))}
    </div>
  );
}

export interface PreferencesPanelProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
}

const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

function moveTabSelection(
  event: KeyboardEvent,
  current: CategoryId,
  onChange: (id: CategoryId) => void,
): void {
  const index = CATEGORY_IDS.indexOf(current);
  if (index < 0) return;
  let next: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown": next = (index + 1) % CATEGORY_IDS.length; break;
    case "ArrowLeft":
    case "ArrowUp":   next = (index - 1 + CATEGORY_IDS.length) % CATEGORY_IDS.length; break;
    case "Home":      next = 0; break;
    case "End":       next = CATEGORY_IDS.length - 1; break;
    default: return;
  }
  event.preventDefault();
  onChange(CATEGORY_IDS[next]!);
}

export function PreferencesPanel({
  theme,
  onThemeChange,
  language,
  onLanguageChange,
}: PreferencesPanelProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<CategoryId>("appearance");
  const tabRefs = useRef<Map<CategoryId, HTMLButtonElement | null>>(new Map());

  return (
    <div className="pref-body">
      <nav
        className="pref-nav"
        role="tablist"
        aria-label={t("pref.title")}
        onKeyDown={(event) => {
          moveTabSelection(event, active, (id) => {
            setActive(id);
            tabRefs.current.get(id)?.focus();
          });
        }}
      >
        {CATEGORIES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            ref={(el) => { tabRefs.current.set(id, el); }}
            type="button"
            role="tab"
            id={`pref-tab-${id}`}
            className={`pref-nav-item ${active === id ? "active" : ""}`}
            aria-selected={active === id}
            aria-controls={`pref-panel-${id}`}
            tabIndex={active === id ? 0 : -1}
            data-modal-initial-focus={active === id ? "" : undefined}
            onClick={() => setActive(id)}
          >
            <Icon size={14} />
            <span className="pref-nav-label">{t(labelKey)}</span>
          </button>
        ))}
      </nav>

      <div className="pref-content">
        <div
          role="tabpanel"
          id="pref-panel-appearance"
          aria-labelledby="pref-tab-appearance"
          hidden={active !== "appearance"}
        >
          {active === "appearance" && (
            <AppearanceSection
              theme={theme}
              onThemeChange={onThemeChange}
            />
          )}
        </div>
        <div
          role="tabpanel"
          id="pref-panel-language"
          aria-labelledby="pref-tab-language"
          hidden={active !== "language"}
        >
          {active === "language" && (
            <LanguageSection
              language={language}
              onLanguageChange={onLanguageChange}
            />
          )}
        </div>
      </div>

    </div>
  );
}
