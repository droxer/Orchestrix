import { useTranslation } from "react-i18next";
import type { TaskPriority } from "../types";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * Priority is a rank, not a status — so it gets its own visual language:
 * three ascending signal bars filled to the level (low = 1, normal = 2,
 * high = 3) instead of the leading status dot the generic Badge uses. The
 * accent escalates low → normal → high (muted → ink → warn) — warn, not the
 * bad tier: priority is a rank, never failure severity. The textual label
 * doubles as the tooltip.
 */
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useTranslation();
  const label = t(`backlog.priorities.${priority}`);
  return (
    <Tooltip content={label}>
      <span className="priority-badge" data-priority={priority}>
        <span className="priority-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="priority-badge-label">{label}</span>
      </span>
    </Tooltip>
  );
}
