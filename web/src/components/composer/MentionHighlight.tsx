import { forwardRef } from "react";
import { mentionSegments, type ParsedMention } from "../../lib/mentions";

/**
 * The `@Name` pills the composer draws behind its textarea.
 *
 * A textarea cannot style a range of its own value, so the draft is mirrored
 * into this layer glyph-for-glyph — same font, same padding, same wrapping —
 * with the mention runs given a pill. The mirror's own text is transparent:
 * what you read is still the real textarea on top, so caret, selection, and
 * IME behaviour are untouched. The layer is inert to the pointer.
 */
export const MentionHighlight = forwardRef<HTMLDivElement, {
  text: string;
  mentions: readonly ParsedMention[];
}>(function MentionHighlight({ text, mentions }, ref) {
  return (
    <div ref={ref} className="composer-highlight" aria-hidden="true">
      {mentionSegments(text, mentions).map((segment, index) => (
        segment.mention ? (
          <span
            key={index}
            className="composer-mention-token"
            data-eligible={segment.eligible || undefined}
          >
            {segment.text}
          </span>
        ) : (
          // A trailing newline needs a glyph after it or the mirror ends one
          // line short of the textarea and the pills drift upward.
          <span key={index}>{segment.text}</span>
        )
      ))}
      {text.endsWith("\n") ? "​" : null}
    </div>
  );
});
