/** Pure decisions behind the Markdown renderer.
 *
 * These live outside the component so they can be unit-tested — `web/tests`
 * compiles against `packages/tsconfig.json`, which excludes `web/src/components`.
 */

/** Reading context a Markdown body is rendered into.
 *
 * `chat` is the transcript column: body copy sized to match the user bubble so
 * both voices share one rhythm. `document` is the thread space preview, where
 * the same Markdown is a standalone artifact and wants document scale, a
 * reading measure, and a heading ladder that can afford to start at 20px.
 */
export type MarkdownVariant = "chat" | "document";

/** Fence languages rendered as a diagram rather than highlighted source. */
const DIAGRAM_LANGUAGES = new Set(["mermaid"]);

/**
 * Language of a fenced block, read off the `language-*` class react-markdown
 * puts on the inner `<code>`. Returns null for a bare fence.
 */
export function fenceLanguage(className: string | undefined | null): string | null {
  const match = /language-([\w+-]+)/.exec(className ?? "");
  return match ? match[1].toLowerCase() : null;
}

/** Whether a fence language names a diagram dialect. */
export function isDiagramFence(language: string | null): boolean {
  return language !== null && DIAGRAM_LANGUAGES.has(language);
}

/**
 * Whether a diagram fence should actually be drawn.
 *
 * A streaming fence is a prefix of its final source: `graph TD\n  A -->` is not
 * a diagram, it is the first half of one. Parsing it throws, and re-parsing on
 * every token would strobe the transcript. So a live fence stays highlighted
 * source and becomes a diagram once the turn settles — the block keeps its
 * place in the flow either way.
 */
export function shouldRenderDiagram(language: string | null, live: boolean): boolean {
  return !live && isDiagramFence(language);
}

/**
 * Mermaid runtime configuration.
 *
 * `securityLevel: "strict"` is load-bearing, not a default worth relaxing:
 * diagram source is agent-authored and therefore untrusted, and strict is what
 * disables click bindings and raw HTML labels inside the rendered SVG. The rest
 * of this renderer keeps raw HTML escaped (no rehype-raw); Mermaid must not
 * become the hole in that.
 */
export function mermaidConfig(dark: boolean) {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
    fontFamily: "inherit",
  } as const;
}

/** Stable, DOM-safe id for a Mermaid render pass. */
export function diagramElementId(seq: number): string {
  return `relay-mermaid-${seq}`;
}
