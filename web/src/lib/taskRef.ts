/**
 * The short, human-quotable reference for a task.
 *
 * Relay ids are `task_<base36 timestamp>_<6 random chars>` (see
 * `backend/relay/core/ids.py`). The whole id is 25+ characters — unusable as
 * a column and unreadable aloud — but its last segment is already the random
 * part, so it is the discriminating half and stays stable for the life of the
 * record. That is what the list prints: enough to say "look at AB12CD" and
 * enough to find the row again with the search field, which matches on `id`.
 *
 * No dashes or prefixes are invented here. A reference the reader cannot
 * paste back into search would be decoration, not an identifier.
 */
export function taskRef(id: string): string {
  const segments = id.split("_").filter(Boolean);
  const tail = segments.length > 1 ? segments[segments.length - 1] : id;
  return tail.slice(-6).toUpperCase();
}
