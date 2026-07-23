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
