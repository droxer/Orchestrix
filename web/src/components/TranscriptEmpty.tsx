import { useTranslation } from "react-i18next";
import { RelayEmptyState } from "./RelayEmptyState";
import { RelayMark } from "./RelayMark";
import { RelayDoodleChevron } from "./marginalia";
import { ActionPrompt } from "./icons";
import { sendShortcutLabel } from "../lib/sendShortcut";

type TranscriptEmptyProps = {
  selectedEmployee: string;
  /** A starter chip drops its prompt into the composer and focuses it. */
  onSuggestion?: (text: string) => void;
};

const SUGGESTION_KEYS = ["plan", "review", "orient"] as const;

export function TranscriptEmpty({
  selectedEmployee,
  onSuggestion,
}: TranscriptEmptyProps) {
  const { t } = useTranslation();
  const ready = Boolean(selectedEmployee);
  const headline = ready
    ? t("transcript.ready_for")
    : t("transcript.ready_no_employee");

  return (
    <RelayEmptyState
      className="transcript-empty"
      titleId="transcript-empty-headline"
      marginalia={<RelayDoodleChevron />}
      kicker={(
        <span className="transcript-empty-kicker">
          <RelayMark width={11} height={11} />
          {t("thread.new_thread")}
        </span>
      )}
      title={headline}
      body={t("transcript.landing_body")}
      illustration={(
        <span className="relay-empty-avatar" aria-hidden="true">
          <RelayMark width={30} height={30} />
        </span>
      )}
      actions={ready && onSuggestion ? (
        <div className="transcript-empty-suggestions">
          {SUGGESTION_KEYS.map((key) => {
            const text = t(`transcript.suggestion_${key}`);
            return (
              <button
                key={key}
                type="button"
                className="transcript-empty-suggestion"
                onClick={() => onSuggestion(text)}
              >
                <span>{text}</span>
                <ActionPrompt width={13} height={13} />
              </button>
            );
          })}
        </div>
      ) : undefined}
      hint={ready ? (
        <span className="transcript-empty-hints">
          <span className="transcript-empty-hint">
            <kbd className="command-kbd">@</kbd>
            {t("transcript.hint_mention")}
          </span>
          <span className="transcript-empty-hint">
            <kbd className="command-kbd">{sendShortcutLabel()}</kbd>
            {t("transcript.hint_send")}
          </span>
        </span>
      ) : undefined}
    />
  );
}
