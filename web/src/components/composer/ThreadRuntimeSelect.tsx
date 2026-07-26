import { MonitorCog } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DaemonNodeMonitorRecord } from "../../types";
import { ActionEdit } from "../icons";
import { Button } from "../ui/button";
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

export function ThreadRuntimeSelect({
  nodes,
  value,
  onValueChange,
  onRename,
}: {
  nodes: DaemonNodeMonitorRecord[];
  value: string | null;
  onValueChange: (nodeId: string) => void;
  onRename: (node: DaemonNodeMonitorRecord) => void;
}) {
  const { t } = useTranslation();
  const selected = nodes.find((node) => node.id === value);
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
          disabled={nodes.length === 0}
          aria-label={t("thread.choose_computer")}
        >
          <MonitorCog size={16} aria-hidden="true" />
          <span className="thread-runtime-select-name">
            {selected ? runtimeLabel(selected) : t("thread.no_computers")}
          </span>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} side="top">
          {nodes.map((node) => (
            <SelectItem key={node.id} value={node.id} label={runtimeLabel(node)}>
              <MonitorCog size={15} aria-hidden="true" />
              <span>{runtimeLabel(node)}</span>
              <small className="thread-runtime-option-id">{node.id}</small>
            </SelectItem>
          ))}
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
}
