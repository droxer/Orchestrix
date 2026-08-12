import { useTranslation } from "react-i18next";
import type { MentionCandidate } from "../../lib/mentions";
import { IdentityMonogram } from "../IdentityMonogram";
import { ProfileImage } from "../ProfileImagePicker";

/**
 * Autocomplete list for `@` in the composer. Presentational: the highlight
 * lives in the composer, because the textarea's key handler moves it.
 *
 * Ineligible agents stay listed but unselectable with their reason spelled
 * out — an agent that lives on another computer is a fact worth showing, not
 * an absence to puzzle over.
 */
export function MentionPopup({ matches, activeIndex, onHover, onPick }: {
  matches: readonly MentionCandidate[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (candidate: MentionCandidate) => void;
}) {
  const { t } = useTranslation();
  if (matches.length === 0) return null;
  return (
    <div className="mention-popup" role="listbox" aria-label={t("composer.mention_list")}>
      {matches.map((candidate, index) => (
        <button
          key={candidate.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className="mention-option"
          data-active={index === activeIndex || undefined}
          disabled={!candidate.eligible}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            // Keep focus in the textarea: a blur would close the popup before
            // the click lands.
            event.preventDefault();
            if (candidate.eligible) onPick(candidate);
          }}
        >
          <ProfileImage
            src={candidate.profileImageUrl}
            alt=""
            fallback={<IdentityMonogram name={candidate.displayName} size={8} />}
            className="mention-option-mark"
          />
          <span translate="no">{candidate.displayName}</span>
          {candidate.reason ? (
            <span className="mention-option-reason">
              {t(`composer.mention_reason.${candidate.reason}`)}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
