import { useTranslation } from "react-i18next";
import type { AgentTaskMode } from "../../types";
import { ModeImplement, ModeReview } from "../icons";

export function ModeToggle({ mode, setMode }: {
  mode: AgentTaskMode;
  setMode: (mode: AgentTaskMode) => void;
}) {
  const { t } = useTranslation();
  const next: AgentTaskMode = mode === "implement" ? "review" : "implement";
  const Icon = mode === "implement" ? ModeImplement : ModeReview;
  return (
    <button
      type="button"
      className="mode-chip"
      data-mode={mode}
      aria-label={t("composer.choose_mode")}
      title={`${t(`mode.${next}`)} (Shift+Tab)`}
      onClick={() => setMode(next)}
    >
      <Icon className="mode-chip-icon" size={13} aria-hidden="true" />
      <span className="mode-chip-label">{t(`mode.${mode}`)}</span>
      <span className="mode-chip-hint" aria-hidden="true">⇧⇥</span>
    </button>
  );
}
