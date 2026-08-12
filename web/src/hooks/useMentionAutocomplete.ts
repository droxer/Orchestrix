import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activeMentionQuery,
  applyMention,
  type MentionCandidate,
} from "../lib/mentions";

export type MentionAutocomplete = {
  /** Rows to render; empty means the popup is closed. */
  matches: MentionCandidate[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** Track the caret so the open `@…` fragment can be found. */
  onCaretChange: (caret: number) => void;
  close: () => void;
  /** Handle a key while the popup is open; false means the composer keeps it. */
  handleKey: (key: string) => boolean;
  pick: (candidate: MentionCandidate) => void;
};

/**
 * Owns the `@` autocomplete for a composer draft.
 *
 * The draft text stays in the composer; this hook only derives what the popup
 * shows and splices an accepted name back through `setText`. Keeping the text
 * in one place is what lets the plain textarea survive untouched.
 */
export function useMentionAutocomplete({ text, candidates, setText, textareaRef }: {
  text: string;
  candidates: readonly MentionCandidate[];
  setText: (text: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}): MentionAutocomplete {
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const open = useMemo(() => activeMentionQuery(text, caret), [text, caret]);
  const matches = useMemo(() => {
    if (!open || dismissedAt === open.start) return [];
    const needle = open.query.trim().toLowerCase();
    return candidates.filter(
      (candidate) => !needle || candidate.displayName.toLowerCase().includes(needle),
    );
  }, [candidates, dismissedAt, open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open?.query, open?.start]);

  const close = useCallback(() => {
    setDismissedAt(open ? open.start : null);
  }, [open]);

  const pick = useCallback(
    (candidate: MentionCandidate) => {
      if (!open || !candidate.eligible) return;
      const applied = applyMention(text, open.start, caret, candidate.displayName);
      setText(applied.text);
      setDismissedAt(null);
      // The caret must land after the inserted name, which React would
      // otherwise push to the end of the value on the next render.
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(applied.caret, applied.caret);
        setCaret(applied.caret);
      });
    },
    [caret, open, setText, text, textareaRef],
  );

  const handleKey = useCallback(
    (key: string) => {
      if (matches.length === 0) return false;
      if (key === "ArrowDown") {
        setActiveIndex((index) => (index + 1) % matches.length);
        return true;
      }
      if (key === "ArrowUp") {
        setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
        return true;
      }
      if (key === "Enter" || key === "Tab") {
        const candidate = matches[Math.min(activeIndex, matches.length - 1)];
        if (!candidate?.eligible) return false;
        pick(candidate);
        return true;
      }
      if (key === "Escape") {
        close();
        return true;
      }
      return false;
    },
    [activeIndex, close, matches, pick],
  );

  return {
    matches,
    activeIndex: Math.min(activeIndex, Math.max(matches.length - 1, 0)),
    setActiveIndex,
    onCaretChange: setCaret,
    close,
    handleKey,
    pick,
  };
}
