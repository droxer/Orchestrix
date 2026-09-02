"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";

/* Linear-style inline creation: a bare title field inside the lane/list it
   will land in. Enter commits and keeps the field open for the next one;
   Escape or an empty blur cancels. A failed commit keeps the text. */

export function InlineTaskCreate({
  onSubmit,
  onClose,
}: {
  /** Returns true when the task was created and the field may clear. */
  onSubmit: (title: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function commit() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const created = await onSubmit(trimmed);
      if (created) setTitle("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Input
      className="backlog-inline-create"
      name="backlog-inline-create"
      autoComplete="off"
      spellCheck={false}
      // Autofocus is the point: the field only exists after an explicit
      // create intent (chord, palette, or the lane's + button).
      autoFocus
      aria-label={t("backlog.new_task")}
      placeholder={t("backlog.inline_title_placeholder")}
      value={title}
      disabled={saving}
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onBlur={() => {
        if (!saving) onClose();
      }}
    />
  );
}
