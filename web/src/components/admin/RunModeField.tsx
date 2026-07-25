"use client";

import { useTranslation } from "react-i18next";

export type RunLocation = "managed" | "employee-device";

interface RunModeFieldProps {
  value: RunLocation;
  onChange: (location: RunLocation) => void;
  /** Distinguishes radio groups when two drawers render the field. */
  name: string;
  disabled?: boolean;
}

const RUN_MODE_OPTIONS: Array<{ location: RunLocation; kind: "managed" | "local" }> = [
  { location: "managed", kind: "managed" },
  { location: "employee-device", kind: "local" },
];

export function RunModeField({ value, onChange, name, disabled }: RunModeFieldProps) {
  const { t } = useTranslation();
  const activeKind = value === "managed" ? "managed" : "local";

  return (
    <div className="adm-profile-field">
      <div
        className="adm-profile-segment"
        role="radiogroup"
        aria-label={t("admin.v2.run_mode")}
      >
        {RUN_MODE_OPTIONS.map(({ location, kind }) => {
          const selected = value === location;
          return (
            <label key={location} className="adm-profile-segment-option">
              <input
                className="adm-profile-segment-input"
                type="radio"
                name={name}
                value={location}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(location)}
              />
              <span className="adm-profile-segment-btn" data-active={selected ? "true" : "false"}>
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
