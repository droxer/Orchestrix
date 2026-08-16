/**
 * Overlay breakpoints shared between CSS and JS. The 820px takeover in
 * mobile-overlays.css turns every drawer/dialog into a full-viewport sheet;
 * JS that needs the same threshold (e.g. ArtifactsDrawer's collapsed strip)
 * imports this instead of hardcoding the magic string.
 */
export const OVERLAY_TAKEOVER_QUERY = "(max-width: 820px)";
