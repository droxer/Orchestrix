"use client";

/**
 * Executes inline bootstrap code while the server HTML is parsed, then turns
 * it inert when React renders the client boundary during hydration.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
