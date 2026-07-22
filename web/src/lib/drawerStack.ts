type DrawerEntry = { id: symbol; layer: number };

let entries: DrawerEntry[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

/** Subscribe to drawer stack changes (for underlay styling). */
export function subscribeDrawerStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Register an open drawer; higher `layer` values stack on top. */
export function registerDrawer(id: symbol, layer: number, open: boolean): void {
  entries = entries.filter((entry) => entry.id !== id);
  if (open) entries.push({ id, layer });
  entries.sort((a, b) => a.layer - b.layer);
  notify();
}

/** True when another drawer is stacked above this one. */
export function isDrawerUnderlay(id: symbol): boolean {
  if (entries.length <= 1) return false;
  const top = entries[entries.length - 1];
  return top.id !== id;
}

/** True when no drawer is stacked above this one — i.e. it owns the keyboard. */
export function isDrawerTop(id: symbol): boolean {
  if (entries.length === 0) return true;
  return entries[entries.length - 1].id === id;
}
