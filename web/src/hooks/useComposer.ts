import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { MentionableAgent } from "../lib/agentDisplayNames";
import { resizeComposerTextarea } from "../lib/composerResize";

// Composer text + @mention autocomplete state and behavior. The host wires the
// returned handlers to the textarea and renders the popover from
// filteredMentionAgents. The picked logical-agent id stays with the draft so
// send routing does not depend on an asynchronous header-selection update.
export function useComposer({ mentionAgents }: {
  mentionAgents: MentionableAgent[];
}): {
  composerText: string;
  setComposerText: Dispatch<SetStateAction<string>>;
  mentionOpen: boolean;
  setMentionOpen: Dispatch<SetStateAction<boolean>>;
  mentionIndex: number;
  setMentionIndex: Dispatch<SetStateAction<number>>;
  setIsComposing: Dispatch<SetStateAction<boolean>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  filteredMentionAgents: MentionableAgent[];
  syncMentionState: (text: string, caret: number) => void;
  insertMention: (agent: MentionableAgent) => void;
  getMentionedAgentId: () => string | null;
  clearMentionedAgent: () => void;
  resizeTextarea: () => void;
} {
  const [composerText, setComposerText] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionedAgentIdRef = useRef<string | null>(null);

  const resizeTextarea = useCallback(() => {
    resizeComposerTextarea(textareaRef.current);
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [composerText, resizeTextarea]);

  function detectMentionToken(text: string, caret: number): { start: number; query: string } | null {
    const m = /(?:^|\s)@([^\s@]*)$/i.exec(text.slice(0, caret));
    if (!m) return null;
    return { start: m.index === 0 ? 0 : m.index + 1, query: m[1].toLowerCase() };
  }

  function syncMentionState(text: string, caret: number) {
    if (isComposing) return;
    const token = detectMentionToken(text, caret);
    if (token) {
      setMentionOpen(true);
      setMentionQuery((prev) => {
        if (prev !== token.query) setMentionIndex(0);
        return token.query;
      });
    }
    else if (mentionOpen) setMentionOpen(false);
  }

  function insertMention(agent: MentionableAgent) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? composerText.length;
    const token = detectMentionToken(composerText, caret);
    const start = token?.start ?? caret;
    const inserted = `@${agent.displayName} `;
    setComposerText(`${composerText.slice(0, start)}${inserted}${composerText.slice(caret)}`);
    mentionedAgentIdRef.current = agent.id;
    setMentionOpen(false); setMentionQuery(""); setMentionIndex(0);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus(); node.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  }

  const enabledAgents = mentionAgents.filter((agent) => agent.ready);
  const filteredMentionAgents = mentionQuery
    ? enabledAgents.filter((agent) =>
        agent.displayName.toLowerCase().startsWith(mentionQuery)
        || agent.executorKind.startsWith(mentionQuery))
    : enabledAgents;

  return {
    composerText, setComposerText,
    mentionOpen, setMentionOpen,
    mentionIndex, setMentionIndex,
    setIsComposing,
    textareaRef,
    filteredMentionAgents,
    syncMentionState,
    insertMention,
    getMentionedAgentId: () => mentionedAgentIdRef.current,
    clearMentionedAgent: () => { mentionedAgentIdRef.current = null; },
    resizeTextarea,
  };
}
