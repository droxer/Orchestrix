import { isValidElement, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { highlightToHtml } from "../lib/syntax";

type CodeProps = { className?: string; children?: ReactNode };

function nodeText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(nodeText).join("");
  return "";
}

// Shared GitHub-flavored Markdown renderer. A fenced code block always arrives
// as <pre><code>, inline code as a bare <code> — so the block chrome lives in
// the `pre` component. Sniffing newlines in `code` instead would misrender
// single-line fences as inline chips and multi-line code spans as blocks.
const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => {
    const code = isValidElement<CodeProps>(children)
      ? (children as ReactElement<CodeProps>)
      : null;
    const text = nodeText(code?.props.children).replace(/\n$/, "");
    const lang = /language-([\w+-]+)/.exec(code?.props.className ?? "")?.[1] ?? null;
    return (
      <pre className="agent-code">
        {lang ? <span className="agent-code-lang">{lang}</span> : null}
        <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightToHtml(text, lang) }} />
      </pre>
    );
  },
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
      {children}
    </a>
  ),
  // Intrinsic dimensions of markdown images are unknown, so no width/height
  // hints — just lazy-load them instead of blocking on the transcript render.
  img: ({ src, alt, ...rest }) => (
    <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" {...rest} />
  ),
};

/**
 * Renders agent-authored Markdown with GFM tables/strikethrough/task lists and
 * highlighted code fences. Output is HTML-escaped (highlight.js escapes fence
 * bodies); links open in a new tab with `noopener`. Note that remote images
 * referenced by the text still load from their origin.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="agent-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
