import { useTranslation } from "react-i18next";
import type { AgentTaskMode } from "../../types";
import { ModeAction, ModeAsk } from "../icons";
import { Button } from "../ui/button";

// The composer toggles between "Ask" (read-only Q&A) and "Agent" (does work,
// stored as the "action" mode). "review" is a workflow-internal mode and is
// not user-selectable here.
export function ModeToggle({ mode, setMode }: {
  mode: AgentTaskMode;
  setMode: (mode: AgentTaskMode) => void;
}) {
  const { t } = useTranslation();
  const next: AgentTaskMode = mode === "action" ? "ask" : "action";
  const Icon = mode === "ask" ? ModeAsk : ModeAction;
  return (
    <Button variant="ghost"
      type="button"
      className="mode-chip"
      data-mode={mode}
      aria-label={t("composer.choose_mode")}
      title={`${t(`mode.${next}`)} (Shift+Tab)`}
      onClick={() => setMode(next)}
    >
      <span className="mode-chip-icon" key={mode}>
        <Icon size={14} aria-hidden="true" />
      </span>
      <span className="mode-chip-label">{t(`mode.${mode}`)}</span>
      <span className="mode-chip-hint" aria-hidden="true">⇧⇥</span>
    </Button>
  );
}
