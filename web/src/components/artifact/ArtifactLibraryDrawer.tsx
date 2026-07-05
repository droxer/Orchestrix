import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RelayArtifact } from "relay-core";
import { Drawer } from "../admin/Drawer";
import { ArtifactBody } from "./ArtifactBody";
import { ArtifactIndexStrip } from "./ArtifactIndexStrip";
import { ArtifactPreviewHeader } from "./ArtifactPreviewHeader";

function resolveSessionId(artifact: RelayArtifact, fallback: string): string {
  return (artifact as unknown as { sessionId?: string }).sessionId ?? fallback;
}

export function ArtifactLibraryDrawer({
  open,
  onClose,
  artifacts,
  sessionId,
  initialArtifactId,
}: {
  open: boolean;
  onClose: () => void;
  artifacts: RelayArtifact[];
  sessionId: string;
  initialArtifactId?: string;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stripExpanded, setStripExpanded] = useState(false);

  const artifactsRef = useRef(artifacts);
  artifactsRef.current = artifacts;

  // Sync selection when the drawer opens or the initial artifact changes.
  useEffect(() => {
    if (!open) return;
    setSelectedId(initialArtifactId ?? artifactsRef.current[0]?.id ?? null);
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;
    setStripExpanded(isMobile);
  }, [open, initialArtifactId]);

  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedId) ?? artifacts[0] ?? null,
    [artifacts, selectedId],
  );

  const effectiveSessionId = selectedArtifact
    ? resolveSessionId(selectedArtifact, sessionId)
    : sessionId;

  const subtitle = t("artifact.drawer_subtitle", { count: artifacts.length });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      variant="light"
      closeLabel={t("sheet.close")}
      ariaLabel={t("artifact.drawer_title")}
      title={t("artifact.drawer_title")}
      subtitle={subtitle}
      bodyClassName="artifact-library-drawer-body"
    >
      <div className={`artifact-library-shell${stripExpanded ? " strip-expanded" : ""}`}>
        {artifacts.length > 0 ? (
          <ArtifactIndexStrip
            artifacts={artifacts}
            selectedId={selectedId}
            onSelect={setSelectedId}
            expanded={stripExpanded}
            onExpandedChange={setStripExpanded}
          />
        ) : null}

        <section className="artifact-preview-pane" aria-label={t("artifact.preview_label")}>
          {selectedArtifact ? (
            <>
              <ArtifactPreviewHeader
                artifact={selectedArtifact}
                sessionId={effectiveSessionId}
              />
              <div className="artifact-preview-body">
                <ArtifactBody artifact={selectedArtifact} sessionId={effectiveSessionId} />
              </div>
            </>
          ) : (
            <p className="artifact-preview-status">
              {artifacts.length === 0 ? t("artifact.drawer_empty") : t("artifact.preview_placeholder")}
            </p>
          )}
        </section>
      </div>
    </Drawer>
  );
}
