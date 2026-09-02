"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { filterCommands, type CommandGroup, type CommandId, type CommandItem } from "@/lib/commandMenu";
import {
  ActionSearch,
  ICON,
} from "./icons";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogPortal,
  DialogViewport,
} from "@/components/ui/dialog";

/* ⌘K command palette — Linear-style. A thin renderer over lib/commandMenu.ts:
   the catalogue and ranking live there; this owns focus, key handling, and
   the combobox ARIA contract. */

const GROUP_LABEL_KEYS: Record<CommandGroup, string> = {
  navigate: "command.group_navigate",
  create: "command.group_create",
  view: "command.group_view",
};

export function CommandMenu({
  open,
  commands,
  onRun,
  onClose,
}: {
  open: boolean;
  commands: CommandItem[];
  onRun: (id: CommandId) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const visible = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Only the query state is ours now: focus, the scroll lock, and focus
  // restore on close come from the Dialog primitive, which also gives the
  // palette the Tab trap it never had.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the active option in view during keyboard cycling.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-command-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  /* No early return on `!open`: the Dialog renders nothing while closed and,
     more importantly, keeps the panel mounted through its exit animation. */

  function runAt(index: number) {
    const command = visible[index];
    if (!command) return;
    onClose();
    onRun(command.id);
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (visible.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + direction + visible.length) % visible.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runAt(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, visible.length - 1));
    }
  }

  // Group headers divide the flat ranked list without disturbing its order:
  // a header renders where the group changes between adjacent items.
  const rows: ({ kind: "header"; group: CommandGroup } | { kind: "item"; command: CommandItem; index: number })[] = [];
  let lastGroup: CommandGroup | null = null;
  visible.forEach((command, index) => {
    if (command.group !== lastGroup) {
      rows.push({ kind: "header", group: command.group });
      lastGroup = command.group;
    }
    rows.push({ kind: "item", command, index });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPortal>
        <DialogBackdrop className="command-backdrop" />
        <DialogViewport className="command-viewport">
          <DialogContent
            className="command-menu"
            initialFocus={inputRef}
            aria-label={t("command.title")}
          >
            <div className="command-input-row">
              <ActionSearch size={ICON.sm} aria-hidden="true" />
              <Input
                ref={inputRef}
                className="command-input"
                name="command-query"
                autoComplete="off"
                spellCheck={false}
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                aria-activedescendant={visible[activeIndex] ? `command-option-${visible[activeIndex].id}` : undefined}
                aria-label={t("command.title")}
                placeholder={t("command.placeholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            {visible.length === 0 ? (
              <p className="command-empty" role="status">{t("command.empty")}</p>
            ) : (
              <ul className="command-list" id="command-list" role="listbox" ref={listRef} aria-label={t("command.title")}>
                {rows.map((row, i) => row.kind === "header" ? (
                  <li key={`header-${row.group}-${i}`} className="command-group-label" role="presentation">
                    {t(GROUP_LABEL_KEYS[row.group])}
                  </li>
                ) : (
                  <li
                    key={row.command.id}
                    id={`command-option-${row.command.id}`}
                    className="command-item"
                    role="option"
                    aria-selected={row.index === activeIndex}
                    data-active={row.index === activeIndex ? "true" : undefined}
                    data-command-index={row.index}
                    onMouseMove={() => setActiveIndex(row.index)}
                    onClick={() => runAt(row.index)}
                  >
                    <span className="command-item-label">{row.command.label}</span>
                    {row.command.hint ? (
                      <kbd className="command-kbd" aria-hidden="true">{row.command.hint}</kbd>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="command-footer" aria-hidden="true">
              <span className="command-footer-hint"><kbd className="command-kbd">↑↓</kbd> {t("command.hint_navigate")}</span>
              <span className="command-footer-hint"><kbd className="command-kbd">↵</kbd> {t("command.hint_run")}</span>
              <span className="command-footer-hint"><kbd className="command-kbd">esc</kbd> {t("command.hint_close")}</span>
            </div>
          </DialogContent>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
}
