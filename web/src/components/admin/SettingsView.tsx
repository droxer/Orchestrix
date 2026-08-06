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
  MIN_LOCAL_COMPUTERS,
} from "../../lib/computerLimits";

/** Org-wide defaults. Today that is one number — how many personal computers
    an employee may enroll — which every employee follows unless an admin pins
    a different limit on them individually. */
export function SettingsView() {
  const { t } = useTranslation();
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: ({ signal }) => getOrgSettings(signal),
  });
  const saved = settingsQuery.data?.settings.maxLocalComputersPerEmployee;

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
    && parsed >= MIN_LOCAL_COMPUTERS
    && parsed <= MAX_LOCAL_COMPUTERS_CEILING;
  const isDirty = saved !== undefined && value.trim() !== String(saved);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid) {
      setError(t("admin.v2.settings_limit_invalid", {
        min: MIN_LOCAL_COMPUTERS,
        max: MAX_LOCAL_COMPUTERS_CEILING,
      }));
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await updateOrgSettings(parsed);
      await settingsQuery.refetch();
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  const loadError = settingsQuery.error
    ? settingsQuery.error instanceof Error
      ? settingsQuery.error.message
      : String(settingsQuery.error)
    : null;

  return (
    <div className="adm-view adm-settings">
      <form className="adm-settings-card" onSubmit={(event) => void handleSubmit(event)}>
        <div className="adm-settings-head">
          <h2 className="adm-settings-title">{t("admin.v2.settings_computers_title")}</h2>
          <p className="adm-settings-sub">{t("admin.v2.settings_computers_sub")}</p>
        </div>

        <Field
          label={t("admin.v2.settings_limit_label")}
          hint={t("admin.v2.settings_limit_hint", {
            min: MIN_LOCAL_COMPUTERS,
            max: MAX_LOCAL_COMPUTERS_CEILING,
          })}
          error={error ?? loadError ?? undefined}
          errorId="admin-settings-limit-error"
        >
          <Input
            name="max-local-computers"
            type="number"
            inputMode="numeric"
            min={MIN_LOCAL_COMPUTERS}
            max={MAX_LOCAL_COMPUTERS_CEILING}
            step={1}
            value={value}
            disabled={settingsQuery.isLoading || isBusy}
            aria-invalid={value !== "" && !isValid}
            aria-describedby={error || loadError ? "admin-settings-limit-error" : undefined}
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
    </div>
  );
}
