"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { RelayArtifact } from "relay-core";
import {
  isThreadSpaceEmpty,
  resolveSelectedSpaceItem,
  type SpaceItem,
} from "../../lib/threadSpace";
import { ArtifactBody } from "../artifact/ArtifactBody";
import { ArtifactPreviewHeader } from "../artifact/ArtifactPreviewHeader";
import { ThreadSpaceList } from "./ThreadSpaceList";
import { NavBack } from "../icons";
import { Button } from "@/components/ui/button";
import { OverlayCloseButton } from "@/components/ui/OverlayCloseButton";

function resolveSessionId(artifact: RelayArtifact, fallback: string): string {
  return (artifact as unknown as { sessionId?: string }).sessionId ?? fallback;
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
  const effectiveSessionId = selected ? resolveSessionId(selected.artifact, sessionId) : sessionId;

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    handle.setPointerCapture(event.pointerId);
    onResizeActive(true);
    const move = (moveEvent: PointerEvent) => onResize(width + (startX - moveEvent.clientX), false);
    const up = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      onResize(width + (startX - upEvent.clientX), true);
      onResizeActive(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }, [onResize, onResizeActive, width]);

  const resizeByKeyboard = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onResize(width + (event.key === "ArrowLeft" ? 16 : -16), true);
  }, [onResize, width]);

  return (
    <aside className="thread-space-panel" aria-label={t("space.panel_label")}>
      <div
        className="thread-space-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("space.resize_label")}
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
          <OverlayCloseButton label={t("sheet.close")} onClick={onClose} />
        </header>
        {selected ? (
          <div className="thread-space-preview">
            <ArtifactPreviewHeader artifact={selected.artifact} sessionId={effectiveSessionId} />
            <div className="artifact-preview-body">
              <ArtifactBody artifact={selected.artifact} sessionId={effectiveSessionId} />
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
