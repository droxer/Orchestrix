/** Platform-aware label for the composer send chord (send button title). */
export function sendShortcutLabel(): string {
  if (typeof navigator === "undefined") return "⌘ Enter";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "⌘ Enter" : "Ctrl+Enter";
}
