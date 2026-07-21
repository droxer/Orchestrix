import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { formatRelativeTime, isNodeOnline } from "../../lib/adminHelpers";

interface NodePresenceProps {
  node: ControlPanelDaemonNodeRecord;
  t: TFunction;
  className?: string;
}

/**
 * Monochrome online/offline cue for a single computer. Online = a filled, calm
 * dot with a slow breathing halo (motion carries "alive"); offline = a static,
 * bright hollow ring ("dark / no signal", and bright so it catches the eye).
 * The animation is disabled under prefers-reduced-motion.
 */
export function NodePresence({ node, t, className }: NodePresenceProps) {
  const online = isNodeOnline(node);
  const label = online
    ? t("fleet.presence_online")
    : t("fleet.presence_offline");
  const title = online
    ? t("fleet.presence_online_title")
    : t("fleet.presence_offline_title", { time: formatRelativeTime(node.lastSeenAt, t) });
  return (
    <span
      className={`adm-presence${className ? ` ${className}` : ""}`}
      data-online={online ? "true" : "false"}
      role="img"
      aria-label={label}
      title={title}
    />
  );
}
