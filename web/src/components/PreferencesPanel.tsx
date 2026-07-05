"use client";

import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_THEMES,
  type Language,
  type Theme,
} from "../lib/appStorage";
import {
  AGENT_ROLE_VALUES,
  agentRoleMapsEqual,
  normalizeAgentRoleMapPayload,
  type AgentRoleMap,
} from "../lib/manageAgents";
import { AGENT_NAMES } from "../types";
import type { AgentName, AgentRole, DaemonNodeMonitorRecord } from "../types";
import { moveRadioSelection } from "../lib/radioGroupKeyboard";
import { NavLogout, PrefAgents, PrefAppearance, PrefLanguage } from "./icons";

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

/* Settings categories. Adding a new settings area = one entry here plus a
   case in renderSection (and its `pref.<id>` i18n label). The left nav and
   the content panel are both driven by this list. */
type CategoryId = "appearance" | "language" | "agents";

type IconComponent = ComponentType<{ size?: number }>;

const CATEGORIES: { id: CategoryId; labelKey: string; Icon: IconComponent }[] = [
  { id: "appearance", labelKey: "pref.appearance", Icon: PrefAppearance },
  { id: "language", labelKey: "pref.language", Icon: PrefLanguage },
  { id: "agents", labelKey: "pref.agents", Icon: PrefAgents },
];

const LANGUAGE_BADGES: Record<Language, string> = {
  en: "EN",
  "zh-CN": "简",
  "zh-TW": "繁",
};

function PrefSelectedCheck() {
  return (
    <span className="pref-option-check" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="7" fill="var(--color-primary)" />
        <path d="M4 7l2 2 4-4" stroke="var(--color-on-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

function AgentBadge({ agent }: { agent: AgentName }) {
  return (
    <span className="pref-agent-badge" data-agent={agent} translate="no" aria-hidden="true">
      {agent.slice(0, 2)}
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
  headingId,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  headingId: string;
}) {
  const { t } = useTranslation();
  const refs = useRef<Map<Theme, HTMLButtonElement | null>>(new Map());
  const registerRef = (value: Theme, el: HTMLButtonElement | null) => { refs.current.set(value, el); };
  const renderOption = (value: Theme) => (
    <ThemeOption
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
        <div className="pref-option-list">
          {BASE_THEMES.map(renderOption)}
        </div>
        <p className="pref-group-label pref-group-label--spaced">{t("pref.theme.contrast_group")}</p>
        <div className="pref-option-list">
          {CONTRAST_THEMES.map(renderOption)}
        </div>
      </div>
    </>
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
        <span className="pref-option-sub">{label}</span>
      </span>
      {selected ? <PrefSelectedCheck /> : null}
    </button>
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
  const registerRef = (code: Language, el: HTMLButtonElement | null) => { refs.current.set(code, el); };
  return (
    <>
      <h4 id={headingId} className="pref-section-label">
        {t("pref.language")}
      </h4>
      <div
        className="pref-option-list"
        role="radiogroup"
        aria-labelledby={headingId}
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
    </>
  );
}

function roleLabel(t: TFunction, role: AgentRole | undefined): string {
  return role ? t(`agent_role.${role}`) : t("pref.agent_roles.builtin");
}

function AgentRolesSection({
  node,
  onSave,
  headingId,
}: {
  node?: DaemonNodeMonitorRecord | null;
  onSave?: (overrides: AgentRoleMap) => Promise<void>;
  headingId: string;
}) {
  const { t } = useTranslation();
  const nodeId = node?.id ?? null;
  const previousNodeIdRef = useRef<string | null>(null);
  const [initialOverrides, setInitialOverrides] = useState<AgentRoleMap>(() => ({}));
  const [overrides, setOverrides] = useState<AgentRoleMap>(() => ({}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeId) {
      previousNodeIdRef.current = null;
      return;
    }
    if (previousNodeIdRef.current === nodeId) return;
    previousNodeIdRef.current = nodeId;
    const snapshot = normalizeAgentRoleMapPayload(node?.agentRoleOverrides ?? {});
    setInitialOverrides(snapshot);
    setOverrides(snapshot);
    setError(null);
    setSaving(false);
  }, [node?.agentRoleOverrides, nodeId]);

  function setRole(agent: AgentName, role: AgentRole | "") {
    setOverrides((prev) => {
      const next = { ...prev };
      if (role) next[agent] = role;
      else delete next[agent];
      return next;
    });
  }

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    const payload = normalizeAgentRoleMapPayload(overrides);
    try {
      await onSave(payload);
      setInitialOverrides(payload);
      setOverrides(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!node) {
    return (
      <>
        <h4 id={headingId} className="pref-section-label">
          {t("pref.agents")}
        </h4>
        <p className="pref-empty">{t("pref.agent_roles.no_node")}</p>
      </>
    );
  }

  const defaults = node.agentRoleDefaults ?? {};
  const dirty = !agentRoleMapsEqual(overrides, initialOverrides);

  return (
    <>
      <h4 id={headingId} className="pref-section-label">
        {t("pref.agents")}
      </h4>
      <p className="pref-section-note">{t("pref.agent_roles.help")}</p>
      <div className="pref-option-list">
        {AGENT_NAMES.map((agent) => (
          <label key={agent} className="pref-agent-row">
            <AgentBadge agent={agent} />
            <span className="pref-option-copy">
              <span className="pref-option-label" translate="no">{agent}</span>
              <span className="pref-option-sub">
                {t("pref.agent_roles.system_default", { role: roleLabel(t, defaults[agent]) })}
              </span>
            </span>
            <select
              className="pref-agent-select"
              value={overrides[agent] ?? ""}
              onChange={(event) => setRole(agent, event.target.value as AgentRole | "")}
              disabled={saving || !onSave}
              aria-label={t("pref.agent_roles.override_for", { agent })}
            >
              <option value="">{t("pref.agent_roles.use_system_default")}</option>
              {AGENT_ROLE_VALUES.map((role) => (
                <option key={role} value={role}>{t(`agent_role.${role}`)}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="pref-actions">
        <button
          type="button"
          className="pref-save"
          onClick={() => void handleSave()}
          disabled={saving || !dirty || !onSave}
        >
          {saving ? t("pref.saving") : t("pref.save")}
        </button>
        {error ? <p className="pref-error">{t("pref.action_failed", { message: error })}</p> : null}
      </div>
    </>
  );
}

export interface PreferencesPanelProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  agentNode?: DaemonNodeMonitorRecord | null;
  onAgentRoleOverridesChange?: (overrides: AgentRoleMap) => Promise<void>;
  onLogout?: () => void;
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
  agentNode,
  onAgentRoleOverridesChange,
  onLogout,
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
            onClick={() => setActive(id)}
          >
            <Icon size={16} />
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
              headingId="pref-section-appearance"
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
              headingId="pref-section-language"
            />
          )}
        </div>
        <div
          role="tabpanel"
          id="pref-panel-agents"
          aria-labelledby="pref-tab-agents"
          hidden={active !== "agents"}
        >
          {active === "agents" && (
            <AgentRolesSection
              node={agentNode}
              onSave={onAgentRoleOverridesChange}
              headingId="pref-section-agents"
            />
          )}
        </div>
      </div>

      {onLogout ? (
        <footer className="pref-account">
          <button type="button" className="pref-logout" onClick={onLogout}>
            <NavLogout size={16} />
            <span>{t("nav.logout")}</span>
          </button>
        </footer>
      ) : null}
    </div>
  );
}
