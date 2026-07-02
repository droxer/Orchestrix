"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RelayArtifact } from "relay-core";

import { artifactRawHref } from "../lib/artifactPreview";
import { Drawer } from "./admin/Drawer";
import { ArtifactBody } from "./artifact/ArtifactBody";

interface ArtifactTarget {
  artifact: RelayArtifact;
  sessionId: string;
}

interface ArtifactViewerContextValue {
  open: (artifact: RelayArtifact, sessionId: string) => void;
}

const ArtifactViewerContext = createContext<ArtifactViewerContextValue | null>(null);

export function ArtifactViewerProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<ArtifactTarget | null>(null);

  const open = useCallback((artifact: RelayArtifact, sessionId: string) => {
    setTarget({ artifact, sessionId });
  }, []);
  const close = useCallback(() => setTarget(null), []);

  const value = useMemo<ArtifactViewerContextValue>(() => ({ open }), [open]);

  const kindLabel = target
    ? t(`artifact.kind.${target.artifact.kind}`, { defaultValue: target.artifact.kind })
    : "";

  return (
    <ArtifactViewerContext.Provider value={value}>
      {children}
      <Drawer
        open={target !== null}
        onClose={close}
        variant="dark"
        width={680}
        closeLabel={t("sheet.close")}
        ariaLabel={target ? target.artifact.title : undefined}
        title={target ? target.artifact.title : ""}
        subtitle={
          target ? (
            <span className="artifact-viewer-sub">
              <span className={`artifact-kind-tag is-${target.artifact.kind}`}>{kindLabel}</span>
              <a
                className="artifact-viewer-raw"
                href={artifactRawHref(target.sessionId, target.artifact.id)}
                target="_blank"
                rel="noreferrer"
              >
                {t("artifact.open_raw")}
              </a>
            </span>
          ) : undefined
        }
        bodyClassName="artifact-viewer-drawer-body"
      >
        {target ? <ArtifactBody artifact={target.artifact} sessionId={target.sessionId} /> : null}
      </Drawer>
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
