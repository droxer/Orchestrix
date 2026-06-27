import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { highlightToHtml } from "../lib/syntax";

// Shared GitHub-flavored Markdown renderer. Fenced code blocks are
// syntax-highlighted with highlight.js (real per-language grammars); inline
// code stays as a plain <code>.
const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...rest }) => {
    const text = String(children ?? "").replace(/\n$/, "");
    const inline = !/(^|\s)language-/.test(className ?? "") && !text.includes("\n");
    if (inline) {
      return (
        <code className={className} {...rest}>
          {text}
        </code>
      );
    }
    const lang = /language-([\w+-]+)/.exec(className ?? "")?.[1] ?? null;
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
};

/** Renders trusted Markdown prose with GFM tables/strikethrough and highlighted code fences. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="agent-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
