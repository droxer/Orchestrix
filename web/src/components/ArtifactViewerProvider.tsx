"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { RelayArtifact } from "relay-core";
import { ArtifactsDrawer } from "./artifact/ArtifactsDrawer";

interface ArtifactTarget {
  artifact: RelayArtifact;
  sessionId: string;
  allArtifacts: RelayArtifact[];
  /** Drawer stack layer — 1 when opened over another drawer (e.g. TaskDrawer). */
  layer?: number;
}

interface ArtifactViewerContextValue {
  open: (artifact: RelayArtifact, sessionId: string, allArtifacts?: RelayArtifact[], layer?: number) => void;
}

const ArtifactViewerContext = createContext<ArtifactViewerContextValue | null>(null);

export function ArtifactViewerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ArtifactTarget | null>(null);

  const open = useCallback(
    (artifact: RelayArtifact, sessionId: string, allArtifacts?: RelayArtifact[], layer?: number) => {
      setTarget({ artifact, sessionId, allArtifacts: allArtifacts ?? [artifact], layer });
    },
    [],
  );
  const close = useCallback(() => setTarget(null), []);

  const value = useMemo<ArtifactViewerContextValue>(() => ({ open }), [open]);

  return (
    <ArtifactViewerContext.Provider value={value}>
      {children}
      <ArtifactsDrawer
        open={target !== null}
        onClose={close}
        artifacts={target?.allArtifacts ?? []}
        sessionId={target?.sessionId ?? ""}
        initialArtifactId={target?.artifact.id}
        layer={target?.layer ?? 0}
      />
    </ArtifactViewerContext.Provider>
  );
}

export function useArtifactViewer(): ArtifactViewerContextValue {
  const ctx = useContext(ArtifactViewerContext);
  if (!ctx) {
    throw new Error("useArtifactViewer must be used within an ArtifactViewerProvider");
  }
  return ctx;
}
