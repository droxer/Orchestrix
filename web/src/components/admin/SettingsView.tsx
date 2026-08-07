"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getOrgSettings, updateOrgSettings } from "../../api";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  MAX_LOCAL_COMPUTERS_CEILING,
  MAX_TASK_ROUNDS_CEILING,
  MIN_LOCAL_COMPUTERS,
  MIN_TASK_ROUNDS,
} from "../../lib/computerLimits";

/** Org-wide defaults: how many personal computers an employee may enroll, and
    how many extra rounds a task may run when it keeps reporting itself
    unfinished. Each is a default every employee or task follows unless an admin
    pins a different value on one individually. */
export function SettingsView() {
  const { t } = useTranslation();
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: ({ signal }) => getOrgSettings(signal),
  });
  const settings = settingsQuery.data?.settings;
  const loadError = settingsQuery.error
    ? settingsQuery.error instanceof Error
      ? settingsQuery.error.message
      : String(settingsQuery.error)
    : null;

  return (
    <div className="adm-view adm-settings">
      <NumberSettingCard
        name="max-local-computers"
        title={t("admin.v2.settings_computers_title")}
        subtitle={t("admin.v2.settings_computers_sub")}
        label={t("admin.v2.settings_limit_label")}
        hint={t("admin.v2.settings_limit_hint", {
          min: MIN_LOCAL_COMPUTERS,
          max: MAX_LOCAL_COMPUTERS_CEILING,
        })}
        min={MIN_LOCAL_COMPUTERS}
        max={MAX_LOCAL_COMPUTERS_CEILING}
        saved={settings?.maxLocalComputersPerEmployee}
        isLoading={settingsQuery.isLoading}
        loadError={loadError}
        onSave={async (next) => {
          await updateOrgSettings({ maxLocalComputersPerEmployee: next });
          await settingsQuery.refetch();
        }}
      />
      <NumberSettingCard
        name="max-task-rounds"
        title={t("admin.v2.settings_rounds_title")}
        subtitle={t("admin.v2.settings_rounds_sub")}
        label={t("admin.v2.settings_rounds_label")}
        hint={t("admin.v2.settings_rounds_hint", {
          min: MIN_TASK_ROUNDS,
          max: MAX_TASK_ROUNDS_CEILING,
        })}
        min={MIN_TASK_ROUNDS}
        max={MAX_TASK_ROUNDS_CEILING}
        saved={settings?.maxTaskRounds}
        isLoading={settingsQuery.isLoading}
        loadError={loadError}
        onSave={async (next) => {
          await updateOrgSettings({ maxTaskRounds: next });
          await settingsQuery.refetch();
        }}
      />
    </div>
  );
}

interface NumberSettingCardProps {
  name: string;
  title: string;
  subtitle: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  saved: number | undefined;
  isLoading: boolean;
  loadError: string | null;
  onSave: (value: number) => Promise<void>;
}

/** One org-wide whole-number setting. Each card saves only its own field, so
    two admins editing different settings cannot overwrite each other. */
function NumberSettingCard({
  name,
  title,
  subtitle,
  label,
  hint,
  min,
  max,
  saved,
  isLoading,
  loadError,
  onSave,
}: NumberSettingCardProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Seed the field from the server once it answers, and re-seed when a refetch
  // brings a value the user has not edited away from.
  useEffect(() => {
    if (saved === undefined) return;
    setValue(String(saved));
  }, [saved]);

  const parsed = Number(value);
  const isValid =
    value.trim() !== ""
    && Number.isInteger(parsed)
    && parsed >= min
    && parsed <= max;
  const isDirty = saved !== undefined && value.trim() !== String(saved);
  const errorId = `admin-settings-${name}-error`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid) {
      setError(t("admin.v2.settings_limit_invalid", { min, max }));
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await onSave(parsed);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <form className="adm-settings-card" onSubmit={(event) => void handleSubmit(event)}>
      <div className="adm-settings-head">
        <h2 className="adm-settings-title">{title}</h2>
        <p className="adm-settings-sub">{subtitle}</p>
      </div>

      <Field
        label={label}
        hint={hint}
        error={error ?? loadError ?? undefined}
        errorId={errorId}
      >
        <Input
          name={name}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={isLoading || isBusy}
          aria-invalid={value !== "" && !isValid}
          aria-describedby={error || loadError ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
            setSavedAt(null);
          }}
        />
      </Field>

      <div className="adm-settings-actions">
        <Button type="submit" disabled={isBusy || !isDirty || !isValid}>
          {isBusy ? t("admin.v2.settings_saving") : t("admin.v2.settings_save")}
        </Button>
        {savedAt !== null && !isDirty ? (
          <span className="adm-settings-saved" role="status">
            {t("admin.v2.settings_saved")}
          </span>
        ) : null}
      </div>
    </form>
  );
}
