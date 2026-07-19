"use client";

import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { NodeLocal, NodeManaged, NodePending } from "../icons";
import {
  nodeExecutionProfile,
  nodeLocalityKinds,
  nodeSandboxProfile,
  type NodeExecutionProfile,
  type StoredNodeTokenMap,
} from "./helpers";

const EXECUTION_ICON: Record<NodeExecutionProfile, typeof NodeManaged> = {
  managed: NodeManaged,
  local: NodeLocal,
  pending: NodePending,
};

interface NodeProfileBadgesProps {
  node: ControlPanelDaemonNodeRecord;
  storedTokens: StoredNodeTokenMap;
  colocated: boolean;
  t: TFunction;
  compact?: boolean;
  /** Drop the "This host" locality — redundant on the node card, where the
   *  status pill already conveys liveness. */
  hideThisHost?: boolean;
  /** Drop the "Saved here" locality on the node card; credential state is
   *  noise in the fleet overview. */
  hideSavedHere?: boolean;
}

export function NodeProfileBadges({ node, storedTokens, colocated, t, compact = false, hideThisHost = false, hideSavedHere = false }: NodeProfileBadgesProps) {
  const execution = nodeExecutionProfile(node);
  const sandbox = nodeSandboxProfile(node);
  const localities = nodeLocalityKinds(node, { storedTokens, colocated })
    .filter((locality) => !(hideThisHost && locality === "this_host"))
    .filter((locality) => !(hideSavedHere && locality === "saved_here"));
  const executionLabel = t(`admin.v2.node_execution_${execution}`);
  const executionHint = t(`admin.v2.node_execution_${execution}_hint`);
  const sandboxLabel = t(`admin.v2.node_sandbox_${sandbox}`);
  const sandboxHint = t(`admin.v2.node_sandbox_${sandbox}_hint`);
  const localityText = localities
    .map((locality) => t(`admin.v2.node_locality_${locality}`))
    .join(" · ");
  const localityHint = localities
    .map((locality) => t(`admin.v2.node_locality_${locality}_hint`))
    .join(" · ");
  const ExecutionIcon = EXECUTION_ICON[execution];

  return (
    <div
      className={`adm-node-profile${compact ? " is-compact" : ""}`}
      aria-label={t("admin.v2.node_profile_label", {
        execution: executionLabel,
        sandbox: sandboxLabel,
      })}
    >
      <span
        className="adm-node-profile-kind"
        data-kind={execution}
        title={executionHint}
        translate="no"
      >
        <ExecutionIcon size={13} className="adm-node-profile-icon" aria-hidden="true" />
        {executionLabel}
      </span>
      <span className="adm-node-profile-sep" aria-hidden="true">·</span>
      <span
        className="adm-node-profile-sandbox"
        data-sandbox={sandbox}
        title={sandboxHint}
      >
        {sandboxLabel}
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
