"use client";

import { useTranslation } from "react-i18next";

export type DaemonSandboxMode = "boxlite" | "none";

interface ExecutionProfileFieldProps {
  value: DaemonSandboxMode;
  onChange: (mode: DaemonSandboxMode) => void;
  /** Distinguishes radio groups when two drawers render the field. */
  name: string;
  disabled?: boolean;
}

const PROFILE_OPTIONS: Array<{ mode: DaemonSandboxMode; kind: "managed" | "local" }> = [
  { mode: "boxlite", kind: "managed" },
  { mode: "none", kind: "local" },
];

export function ExecutionProfileField({ value, onChange, name, disabled }: ExecutionProfileFieldProps) {
  const { t } = useTranslation();
  const activeKind = value === "boxlite" ? "managed" : "local";

  return (
    <div className="adm-profile-field">
      <div
        className="adm-profile-segment"
        role="radiogroup"
        aria-label={t("admin.v2.section_execution_profile")}
      >
        {PROFILE_OPTIONS.map(({ mode, kind }) => {
          const selected = value === mode;
          return (
            <label key={mode} className="adm-profile-segment-option">
              <input
                className="adm-profile-segment-input"
                type="radio"
                name={name}
                value={mode}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(mode)}
              />
              <span className={`adm-profile-segment-btn ${selected ? "active" : ""}`}>
                <span className="adm-profile-segment-dot" data-kind={kind} aria-hidden="true" />
                {t(`admin.v2.node_execution_${kind}`)}
              </span>
            </label>
          );
        })}
      </div>
      <p className="adm-form-hint">{t(`admin.v2.profile_${activeKind}_desc`)}</p>
    </div>
  );
}
