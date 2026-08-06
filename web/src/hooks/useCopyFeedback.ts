import { useEffect, useRef, useState } from "react";
import { COPY_FEEDBACK_MS, copyText } from "../components/admin/helpers";

export function useCopyFeedback() {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  async function copy(field: string, value: string) {
    try {
      await copyText(value);
    } catch {
      // Clipboard write denied (permissions, focus) — leave the button in its
      // uncopied state instead of claiming success.
      return;
    }
    setCopiedField(field);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => setCopiedField((current) => (current === field ? null : current)),
      COPY_FEEDBACK_MS,
    );
  }

  return { copiedField, copy };
}
