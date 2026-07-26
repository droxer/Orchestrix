import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonNodeMonitorRecord } from "../../types";
import { ActionEdit } from "../icons";
import { Button } from "../ui/button";
import { nodeOwnershipProfile } from "../../lib/adminHelpers";
import { nodeOwnershipIcon } from "../admin/NodeProfileBadges";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../ui/select";

function runtimeLabel(node: DaemonNodeMonitorRecord): string {
  const displayName = "displayName" in node && typeof node.displayName === "string"
    ? node.displayName.trim()
    : "";
  return displayName || node.id;
}

/**
 * The computer an already-started thread runs on.
 *
 * A thread is pinned to its computer the moment it starts, so this is a
 * readout, not a control — but it has to stay on screen, because "which
 * machine is my work happening on" is exactly as relevant mid-thread as it was
 * at the start. Unlike the picker (whose options are pre-filtered to live
 * computers) this can point at a machine that has since gone offline, so it
 * carries a liveness dot the picker deliberately omits.
 */
export function ThreadRuntimeReadout({ node }: { node: DaemonNodeMonitorRecord }) {
  const { t } = useTranslation();
  const ownership = nodeOwnershipProfile(node);
  const OwnershipMark = nodeOwnershipIcon(ownership);
  const online = Boolean(node.online) && !node.stale;
  const name = runtimeLabel(node);
  const ownershipLabel = t(`admin.v2.node_ownership_${ownership}`);
  const presenceLabel = online ? t("nodes.presence_online") : t("nodes.presence_offline");
  return (
    <div className="thread-runtime-rail" aria-label={t("thread.runtime_label")}>
      <span className="thread-runtime-context">{t("thread.runs_on")}</span>
      <span className="thread-runtime-divider" aria-hidden="true" />
      <span
        className="thread-runtime-readout"
        data-ownership={ownership}
        data-online={online ? "true" : "false"}
        title={`${name} · ${ownershipLabel} · ${presenceLabel}`}
      >
        <span className="adm-presence" data-online={online ? "true" : "false"} aria-hidden="true" />
        <OwnershipMark size={16} aria-hidden="true" />
        <span className="thread-runtime-readout-name" translate="no">{name}</span>
        <span className="thread-runtime-readout-kind">{ownershipLabel}</span>
        <span className="sr-only">{presenceLabel}</span>
      </span>
    </div>
  );
}

/**
 * Where a new thread will run.
 *
 * Every option is already a live computer — `selectableThreadComputers` filters
 * to online, non-stale, ready/running nodes — so the rows carry no status cue.
 * What actually differs between two live machines is whose they are, so each
 * row leads with the ownership mark (cloud / laptop) and names the kind
 * underneath. The node id shares that second line: it only disambiguates two
 * computers with the same display name, and on the first line it fought the
 * name for width the popup does not have (it used to clip mid-word).
 */
export const ThreadRuntimeSelect = memo(function ThreadRuntimeSelect({
  nodes,
  value,
  selectedNode,
  onValueChange,
  onRename,
}: {
  nodes: DaemonNodeMonitorRecord[];
  value: string | null;
  /**
   * The picked computer resolved against the whole fleet, not just `nodes`.
   * Selectability is a live property — a daemon whose heartbeat lands late
   * drops out of `nodes` for a poll or two — and resolving the label from the
   * filtered list made the trigger flip to "No computer available" and back
   * every few seconds while the pick itself never actually changed.
   */
  selectedNode: DaemonNodeMonitorRecord | null;
  onValueChange: (nodeId: string) => void;
  onRename: (node: DaemonNodeMonitorRecord) => void;
}) {
  const { t } = useTranslation();
  const selected = nodes.find((node) => node.id === value) ?? selectedNode ?? undefined;
  const selectedOwnership = selected ? nodeOwnershipProfile(selected) : null;
  const SelectedMark = selectedOwnership ? nodeOwnershipIcon(selectedOwnership) : null;
  return (
    <div className="thread-runtime-rail" aria-label={t("thread.runtime_label")}>
      <span className="thread-runtime-context">{t("thread.new_thread")}</span>
      <span className="thread-runtime-divider" aria-hidden="true" />
      <Select value={selected?.id ?? null} onValueChange={(nodeId) => {
        if (nodeId) onValueChange(nodeId);
      }}>
        <SelectTrigger
          size="sm"
          className="thread-runtime-select"
          data-ownership={selectedOwnership ?? undefined}
          disabled={nodes.length === 0}
          aria-label={t("thread.choose_computer")}
          title={selected
            ? `${runtimeLabel(selected)} · ${t(`admin.v2.node_ownership_${selectedOwnership}`)}`
            : undefined}
        >
          {SelectedMark ? <SelectedMark size={16} aria-hidden="true" /> : null}
          <span className="thread-runtime-select-name">
            {selected ? runtimeLabel(selected) : t("thread.no_computers")}
          </span>
        </SelectTrigger>
        <SelectContent
          align="start"
          alignItemWithTrigger={false}
          side="top"
          className="thread-runtime-content"
        >
          {nodes.map((node) => {
            const ownership = nodeOwnershipProfile(node);
            const OwnershipMark = nodeOwnershipIcon(ownership);
            const name = runtimeLabel(node);
            return (
              <SelectItem
                key={node.id}
                value={node.id}
                label={name}
                className="thread-runtime-option"
                data-ownership={ownership}
              >
                <OwnershipMark size={16} aria-hidden="true" />
                <span className="thread-runtime-option-body">
                  <span className="thread-runtime-option-name" translate="no">{name}</span>
                  <span className="thread-runtime-option-meta">
                    <span>{t(`admin.v2.node_ownership_${ownership}`)}</span>
                    {name === node.id ? null : (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="thread-runtime-option-id" translate="no">{node.id}</span>
                      </>
                    )}
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        className="thread-runtime-rename"
        disabled={!selected}
        aria-label={t("thread.rename_computer")}
        title={t("thread.rename_computer")}
        onClick={() => {
          if (selected) onRename(selected);
        }}
      >
        <ActionEdit size={13} aria-hidden="true" />
      </Button>
    </div>
  );
});
