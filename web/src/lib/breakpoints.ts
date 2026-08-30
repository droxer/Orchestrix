/**
 * The app has ONE phone breakpoint, and this is it.
 *
 * At 820px and below the shell goes to its mobile layout: every drawer and
 * dialog becomes a full-viewport sheet (mobile-overlays.css), the rail and
 * panels collapse (responsive.css), and the admin tables / transcript rows
 * stack (admin-v2-*.css, chat.css, agent-stream.css). Those last few used to
 * switch at 719/720px instead, which left a 100px band where drawers were
 * already full-screen sheets but the transcript and the tables were still in
 * desktop layout.
 *
 * CSS spells it `(max-width: 820px)` — its complement is `(min-width: 821px)`.
 * JS that needs the same threshold imports this constant; do not re-type the
 * string (`ThreadSpacePanel` had its own copy).
 *
 * The wider layout thresholds (900/1040/1100/1200px) are per-surface column
 * decisions, not this one — they are not phone/desktop and do not belong here.
 */
export const OVERLAY_TAKEOVER_QUERY = "(max-width: 820px)";
