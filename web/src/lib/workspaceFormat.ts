const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Compact "Mon D, HH:MM" timestamp for workspace rows. Shared by the agent
 *  and team workspace surfaces. Returns "" for empty and the raw value for
 *  unparseable input. */
export function compactDate(value: string | undefined, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Compact "Mon D" for a date-only field (`RelayTask.dueDate`, "2026-07-28").
 *  Never renders a time: the value has none, and `new Date("2026-07-28")`
 *  parses as UTC midnight, which invents a clock reading and shifts the day
 *  backwards for viewers west of UTC. Parsed as a local date instead, matching
 *  `formatDueDate` on the backlog. */
export function compactDueDate(value: string | undefined, locale: string): string {
  if (!value) return "";
  const parts = DATE_ONLY.exec(value);
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}
