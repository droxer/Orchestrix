import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { resizeComposerTextarea } from "../lib/composerResize";

// Composer text and textarea sizing stay local so every keystroke does not
// re-render the full application shell and transcript.
export function useComposer(): {
  composerText: string;
  setComposerText: Dispatch<SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  resizeTextarea: () => void;
} {
  const [composerText, setComposerText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = useCallback(() => {
    resizeComposerTextarea(textareaRef.current);
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [composerText, resizeTextarea]);

  return {
    composerText, setComposerText,
    textareaRef,
    resizeTextarea,
  };
}
