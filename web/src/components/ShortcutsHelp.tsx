"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { acquireBodyScrollLock } from "@/lib/bodyScrollLock";
import { commandShortcutLabel } from "@/lib/shortcuts";
import { sendShortcutLabel } from "@/lib/sendShortcut";

/* The `?` overlay — the discoverable registry of every global chord. Linear
   ships the same dialog; the rule is that any shortcut added to
   lib/shortcuts.ts gets a row here, or it effectively does not exist. */

type ShortcutRow = { keys: string; labelKey: string; adminOnly?: boolean };

const GLOBAL_ROWS: ShortcutRow[] = [
  { keys: "command", labelKey: "shortcuts.open_command" },
  { keys: "?", labelKey: "shortcuts.show_help" },
  { keys: "C", labelKey: "shortcuts.new_task" },
  { keys: "N", labelKey: "shortcuts.new_thread" },
];

const NAVIGATE_ROWS: ShortcutRow[] = [
  { keys: "G T", labelKey: "nav.threads" },
  { keys: "G P", labelKey: "project.projects" },
  { keys: "G B", labelKey: "nav.backlog" },
  { keys: "G R", labelKey: "nav.routine" },
  { keys: "G A", labelKey: "nav.agents" },
  { keys: "G E", labelKey: "nav.teams" },
  { keys: "G H", labelKey: "nav.channels" },
  { keys: "G C", labelKey: "nav.computer" },
  { keys: "G D", labelKey: "nav.admin", adminOnly: true },
];

function ShortcutRowView({ keys, label }: { keys: string; label: string }) {
  return (
    <li className="shortcuts-row">
      <span className="shortcuts-row-label">{label}</span>
      <kbd className="command-kbd">{keys}</kbd>
    </li>
  );
}

export function ShortcutsHelp({
  open,
  isAdmin,
  onClose,
}: {
  open: boolean;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const releaseScrollLock = acquireBodyScrollLock();
    panelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      releaseScrollLock();
      previouslyFocused.current?.focus?.();
      previouslyFocused.current = null;
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="overlay-backdrop command-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="command-menu shortcuts-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcuts.title")}
        tabIndex={-1}
      >
        <h2 className="shortcuts-title">{t("shortcuts.title")}</h2>
        <div className="shortcuts-columns">
          <section className="shortcuts-group" aria-label={t("shortcuts.group_global")}>
            <h3 className="command-group-label">{t("shortcuts.group_global")}</h3>
            <ul className="shortcuts-list">
              {GLOBAL_ROWS.map((row) => (
                <ShortcutRowView
                  key={row.labelKey}
                  keys={row.keys === "command" ? commandShortcutLabel() : row.keys}
                  label={t(row.labelKey)}
                />
              ))}
            </ul>
          </section>
          <section className="shortcuts-group" aria-label={t("shortcuts.group_navigate")}>
            <h3 className="command-group-label">{t("shortcuts.group_navigate")}</h3>
            <ul className="shortcuts-list">
              {NAVIGATE_ROWS.filter((row) => !row.adminOnly || isAdmin).map((row) => (
                <ShortcutRowView key={row.labelKey} keys={row.keys} label={t(row.labelKey)} />
              ))}
            </ul>
          </section>
          <section className="shortcuts-group" aria-label={t("shortcuts.group_composer")}>
            <h3 className="command-group-label">{t("shortcuts.group_composer")}</h3>
            <ul className="shortcuts-list">
              <ShortcutRowView keys={sendShortcutLabel()} label={t("shortcuts.send_message")} />
            </ul>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
