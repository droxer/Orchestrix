import { useTranslation } from "react-i18next";
import type { MentionCandidate, ParsedMention } from "../../lib/mentions";
import { IdentityMonogram } from "../IdentityMonogram";
import { ProfileImage } from "../ProfileImagePicker";
import { ActionRemove } from "../icons";

/**
 * Who this message will actually reach, derived live from the draft text.
 *
 * Nothing renders when no one is mentioned: an un-addressed message goes to
 * the whole room, which the thread header already shows.
 */
export function MentionRecipients({ mentions, candidates, onRemove }: {
  mentions: readonly ParsedMention[];
  candidates: readonly MentionCandidate[];
  onRemove: (mention: ParsedMention) => void;
}) {
  const { t } = useTranslation();
  if (mentions.length === 0) return null;
  return (
    <div className="mention-recipients" aria-label={t("composer.mention_recipients")}>
      {mentions.map((mention) => {
        const candidate = candidates.find((item) => item.id === mention.agentId);
        const name = candidate?.displayName ?? mention.text.slice(1);
        return (
          <span
            key={`${mention.start}-${mention.text}`}
            className="mention-chip"
            data-eligible={mention.eligible || undefined}
          >
            {candidate ? (
              <ProfileImage
                src={candidate.profileImageUrl}
                alt=""
                fallback={<IdentityMonogram name={name} size={8} />}
                className="mention-chip-mark"
              />
            ) : null}
            <span translate="no">{name}</span>
            {!mention.eligible ? (
              <span className="mention-chip-reason">
                {t(`composer.mention_reason.${mention.reason ?? "unknown"}`)}
              </span>
            ) : null}
            <button
              type="button"
              className="mention-chip-remove"
              aria-label={t("composer.mention_remove", { name })}
              onClick={() => onRemove(mention)}
            >
              <ActionRemove size={10} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
