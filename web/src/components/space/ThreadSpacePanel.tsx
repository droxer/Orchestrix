"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { artifactRenderMode } from "../../lib/artifactPreview";
import {
  clampSpaceWidth,
  isThreadSpaceEmpty,
  maxSpaceWidth,
  resolveSelectedSpaceItem,
  SPACE_WIDTH_DEFAULT,
  SPACE_WIDTH_MAX,
  SPACE_WIDTH_MIN,
  type SpaceItem,
} from "../../lib/threadSpace";
import { ArtifactBody } from "../artifact/ArtifactBody";
import { ArtifactPreviewHeader } from "../artifact/ArtifactPreviewHeader";
import { ArtifactViewToggle, type ArtifactView } from "../artifact/ArtifactViewToggle";
import { ThreadSpaceList } from "./ThreadSpaceList";
import { NavBack } from "../icons";
import { Button } from "@/components/ui/button";
import { OverlayCloseButton } from "@/components/ui/OverlayCloseButton";
import { useModalDrawer } from "@/hooks/useModalDrawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useChatColumnResize } from "@/hooks/useChatColumnResize";

/** Matches the breakpoint in responsive.css where the panel leaves the shell
 *  grid and covers the viewport. Below it the panel is a modal overlay and
 *  owes the full dialog contract (Escape, focus trap, scroll lock). */
const OVERLAY_QUERY = "(max-width: 820px)";

const KEYBOARD_RESIZE_STEP = 16;

/** The chat column, measured to work out how much width the panel may still
 *  take. Read straight from the DOM rather than threaded down as a prop: the
 *  grid — not React — owns the column's real width. */
function transcriptWidth(): number | null {
  if (typeof document === "undefined") return null;
  const chat = document.getElementById("chat-panel");
  return chat ? chat.getBoundingClientRect().width : null;
}

export function ThreadSpacePanel({
  sessionId,
  items,
  showProducer,
  selectedArtifactId,
  onSelectArtifact,
  onClose,
  width,
  onResize,
  onResizeActive,
}: {
  sessionId: string;
  items: SpaceItem[];
  showProducer: boolean;
  selectedArtifactId: string | null;
  onSelectArtifact: (artifactId: string | null) => void;
  onClose: () => void;
  width: number;
  onResize: (width: number, commit: boolean) => void;
  onResizeActive: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const selected = resolveSelectedSpaceItem(items, selectedArtifactId);
  const isOverlay = useMediaQuery(OVERLAY_QUERY);
  const panelRef = useModalDrawer<HTMLElement>(onClose, isOverlay);

  // Each artifact opens on its rendered reading; the choice is per-artifact,
  // so selecting another one starts from preview again rather than carrying a
  // source view onto a file the user has not looked at yet.
  const [view, setView] = useState<ArtifactView>("preview");
  const selectedId = selected?.artifact.id ?? null;
  useEffect(() => setView("preview"), [selectedId]);
  const renderMode = selected ? artifactRenderMode(selected.artifact) : "none";

  // A drag registers listeners outside React; this releases them if the panel
  // unmounts (or the thread changes) mid-gesture, which would otherwise leak
  // the listeners and strand the shell in its resizing state.
  const releaseDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseDragRef.current?.(), []);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    // Ceiling fixed at gesture start: the transcript shrinks as the drag
    // proceeds, so re-measuring per move would let the panel walk past it.
    const max = maxSpaceWidth(width, transcriptWidth());
    handle.setPointerCapture(event.pointerId);
    onResizeActive(true);

    const widthAt = (clientX: number) => clampSpaceWidth(width + (startX - clientX), max);
    const move = (moveEvent: PointerEvent) => onResize(widthAt(moveEvent.clientX), false);
    const finish = (finalX: number | null) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      releaseDragRef.current = null;
      if (finalX !== null) onResize(widthAt(finalX), true);
      onResizeActive(false);
    };
    const up = (upEvent: PointerEvent) => finish(upEvent.clientX);
    // A cancelled gesture (system takeover, touch interruption) never fires
    // pointerup — without this the shell keeps `data-space-resizing` forever.
    const cancel = () => finish(null);

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    releaseDragRef.current = () => finish(null);
  }, [onResize, onResizeActive, width]);

  const resizeByKeyboard = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const max = maxSpaceWidth(width, transcriptWidth());
    if (event.key === "Home") {
      event.preventDefault();
      onResize(clampSpaceWidth(SPACE_WIDTH_DEFAULT, max), true);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
    onResize(clampSpaceWidth(width + delta, max), true);
  }, [onResize, width]);

  // Anything that narrows the transcript while the panel is open can push it
  // under its floor — a narrowed window, but equally an expanding side rail;
  // give the room back rather than leaving the conversation squeezed. Only
  // ever shrinks — maxSpaceWidth is a ceiling, not a target.
  useChatColumnResize(useCallback(() => {
    const max = maxSpaceWidth(width, transcriptWidth());
    // Not committed: a temporary squeeze shouldn't overwrite the width the
    // user actually chose.
    if (width > max) onResize(max, false);
  }, [onResize, width]), !isOverlay);

  return (
    <aside
      ref={panelRef}
      className="thread-space-panel"
      aria-label={t("space.panel_label")}
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay || undefined}
      tabIndex={isOverlay ? -1 : undefined}
    >
      <div
        className="thread-space-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("space.resize_label")}
        aria-valuenow={width}
        aria-valuemin={SPACE_WIDTH_MIN}
        aria-valuemax={SPACE_WIDTH_MAX}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKeyboard}
      />
      <div className="thread-space-inner">
        <header className="thread-space-header">
          {selected ? (
            <Button
              variant="ghost"
              type="button"
              className="thread-space-back"
              onClick={() => onSelectArtifact(null)}
            >
              <NavBack size={14} />
              <span>{t("space.title")}</span>
            </Button>
          ) : (
            <h2 className="thread-space-title">{t("space.title")}</h2>
          )}
          {selected && renderMode !== "none" ? (
            <ArtifactViewToggle view={view} onChange={setView} className="thread-space-view-toggle" />
          ) : null}
          <OverlayCloseButton label={t("sheet.close")} onClick={onClose} />
        </header>
        {selected ? (
          <div className="thread-space-preview">
            <ArtifactPreviewHeader artifact={selected.artifact} sessionId={sessionId} />
            <div className="artifact-preview-body">
              <ArtifactBody artifact={selected.artifact} sessionId={sessionId} view={view} />
            </div>
          </div>
        ) : isThreadSpaceEmpty(items) ? (
          <div className="thread-space-empty">
            <p className="thread-space-empty-title">{t("space.empty_title")}</p>
            <p className="thread-space-empty-body">{t("space.empty_body")}</p>
          </div>
        ) : (
          <ThreadSpaceList
            items={items}
            showProducer={showProducer}
            selectedId={selectedArtifactId}
            onSelect={(artifactId) => onSelectArtifact(artifactId)}
          />
        )}
      </div>
    </aside>
  );
}
