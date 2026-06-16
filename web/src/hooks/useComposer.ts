import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AgentName } from "../types";

// Composer text + @mention autocomplete state and behavior. The host wires the
// returned handlers to the textarea and renders the popover from
// filteredMentionAgents; picking a mention notifies onAgentPicked so the host
// can route the active agent.
export function useComposer({ agentNames, onAgentPicked }: {
  agentNames: AgentName[];
  onAgentPicked: (agent: AgentName) => void;
}): {
  composerText: string;
  setComposerText: Dispatch<SetStateAction<string>>;
  mentionOpen: boolean;
  setMentionOpen: Dispatch<SetStateAction<boolean>>;
  mentionIndex: number;
  setMentionIndex: Dispatch<SetStateAction<number>>;
  setIsComposing: Dispatch<SetStateAction<boolean>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  filteredMentionAgents: AgentName[];
  syncMentionState: (text: string, caret: number) => void;
  insertMention: (agent: AgentName) => void;
} {
  const [composerText, setComposerText] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function detectMentionToken(text: string, caret: number): { start: number; query: string } | null {
    const m = /(?:^|\s)@([a-z0-9-]*)$/i.exec(text.slice(0, caret));
    if (!m) return null;
    return { start: m.index === 0 ? 0 : m.index + 1, query: m[1].toLowerCase() };
  }

  function syncMentionState(text: string, caret: number) {
    if (isComposing) return;
    const token = detectMentionToken(text, caret);
    if (token) { setMentionOpen(true); setMentionQuery(token.query); setMentionIndex(0); }
    else if (mentionOpen) setMentionOpen(false);
  }

  function insertMention(agent: AgentName) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? composerText.length;
    const token = detectMentionToken(composerText, caret);
    const start = token?.start ?? caret;
    const inserted = `@${agent} `;
    setComposerText(`${composerText.slice(0, start)}${inserted}${composerText.slice(caret)}`);
    setMentionOpen(false); setMentionQuery(""); setMentionIndex(0); onAgentPicked(agent);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus(); node.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  }

  const filteredMentionAgents = mentionQuery ? agentNames.filter((a) => a.startsWith(mentionQuery)) : agentNames;

  return {
    composerText, setComposerText,
    mentionOpen, setMentionOpen,
    mentionIndex, setMentionIndex,
    setIsComposing,
    textareaRef,
    filteredMentionAgents,
    syncMentionState,
    insertMention,
  };
}
