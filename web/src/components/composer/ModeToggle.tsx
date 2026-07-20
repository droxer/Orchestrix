import { useTranslation } from "react-i18next";
import type { AgentTaskMode } from "../../types";
import { ModeAction, ModeAsk } from "../icons";

// The composer toggles between "Ask" (read-only Q&A) and "Agent" (does work,
// stored as the "action" mode). "review" is a workflow-internal mode and is
// not user-selectable here. State is announced via aria-pressed; the label
// names the current and next modes.
export function ModeToggle({ mode, setMode }: {
  mode: AgentTaskMode;
  setMode: (mode: AgentTaskMode) => void;
}) {
  const { t } = useTranslation();
  const next: AgentTaskMode = mode === "action" ? "ask" : "action";
  const Icon = mode === "ask" ? ModeAsk : ModeAction;
  return (
    <button
      type="button"
      className="mode-chip"
      data-mode={mode}
      aria-label={t("composer.mode_toggle_label", { mode: t(`mode.${mode}`), next: t(`mode.${next}`) })}
      aria-pressed={mode === "action"}
      title={t(`mode.${next}`)}
      onClick={() => setMode(next)}
    >
      <span className="mode-chip-icon" key={mode}>
        <Icon size={14} aria-hidden="true" />
      </span>
      <span className="mode-chip-label">{t(`mode.${mode}`)}</span>
    </button>
  );
}
