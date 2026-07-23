import type { TFunction } from "i18next";
import type { ControlPanelDaemonNodeRecord } from "../../types";
import { formatRelativeTime, isNodeOnline } from "../../lib/adminHelpers";

interface NodePresenceProps {
  node: ControlPanelDaemonNodeRecord;
  t: TFunction;
  className?: string;
  withLabel?: boolean;
}

/**
 * Monochrome online/offline cue for a single computer. Online = a filled, calm
 * dot with a slow breathing halo (motion carries "alive"); offline = a static,
 * bright hollow ring ("dark / no signal", and bright so it catches the eye).
 * The animation is disabled under prefers-reduced-motion. Pass withLabel to
 * wrap the dot in a hairline pill with an explicit Online/Offline readout.
 */
export function NodePresence({ node, t, className, withLabel = false }: NodePresenceProps) {
  const online = isNodeOnline(node);
  const label = online
    ? t("fleet.presence_online")
    : t("fleet.presence_offline");
  const title = online
    ? t("fleet.presence_online_title")
    : t("fleet.presence_offline_title", { time: formatRelativeTime(node.lastSeenAt, t) });
  const dataOnline = online ? "true" : "false";
  if (withLabel) {
    return (
      <span
        className={`adm-presence-pill${className ? ` ${className}` : ""}`}
        data-online={dataOnline}
        title={title}
      >
        <span className="adm-presence" data-online={dataOnline} aria-hidden="true" />
        <span className="adm-presence-pill-label">{label}</span>
      </span>
    );
  }
  return (
    <span
      className={`adm-presence${className ? ` ${className}` : ""}`}
      data-online={dataOnline}
      role="img"
      aria-label={label}
      title={title}
    />
  );
}
