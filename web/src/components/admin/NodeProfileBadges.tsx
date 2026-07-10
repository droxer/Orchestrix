"use client";

import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import {
  nodeExecutionProfile,
  nodeLocalityKinds,
  type StoredNodeTokenMap,
} from "./helpers";

interface NodeProfileBadgesProps {
  node: ControlPanelDaemonNodeRecord;
  storedTokens: StoredNodeTokenMap;
  colocated: boolean;
  t: TFunction;
  compact?: boolean;
}

export function NodeProfileBadges({ node, storedTokens, colocated, t, compact = false }: NodeProfileBadgesProps) {
  const execution = nodeExecutionProfile(node);
  const localities = nodeLocalityKinds(node, { storedTokens, colocated });
  const executionLabel = t(`admin.v2.node_execution_${execution}`);
  const executionHint = t(`admin.v2.node_execution_${execution}_hint`);
  const localityText = localities
    .map((locality) => t(`admin.v2.node_locality_${locality}`))
    .join(" · ");
  const localityHint = localities
    .map((locality) => t(`admin.v2.node_locality_${locality}_hint`))
    .join(" · ");

  return (
    <div
      className={`adm-node-profile${compact ? " is-compact" : ""}`}
      aria-label={t("admin.v2.node_profile_label", { execution: executionLabel })}
    >
      <span
        className="adm-node-profile-kind"
        data-kind={execution}
        title={executionHint}
        translate="no"
      >
        {executionLabel}
      </span>
      {localityText ? (
        <>
          <span className="adm-node-profile-sep" aria-hidden="true">·</span>
          <span className="adm-node-profile-locality" title={localityHint} translate="no">
            {localityText}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function FleetProfileLegend({ t }: { t: TFunction }) {
  return (
    <p className="adm-fleet-profile-hint" role="note">
      {t("admin.v2.fleet_profile_legend_copy")}
    </p>
  );
}
