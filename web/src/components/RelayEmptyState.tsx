import { useId, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type RelayEmptyStateProps = {
  title: string;
  body?: string;
  hint?: ReactNode;
  /** Small label above the title — the landing hero's "New thread" line. */
  kicker?: ReactNode;
  illustration?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId?: string;
  /** Heading level for the title (default 2). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  mark?: boolean;
  fill?: boolean;
  /** Optional field-notes vignette sketched in a corner of a roomy surface. */
  marginalia?: ReactNode | null;
};

export function RelayEmptyState({
  title,
  body,
  hint,
  kicker,
  illustration,
  actions,
  className,
  titleId,
  headingLevel = 2,
  mark = false,
  fill = false,
  marginalia,
}: RelayEmptyStateProps) {
  const generatedTitleId = useId();
  const resolvedTitleId = titleId ?? generatedTitleId;
  const TitleTag = `h${headingLevel}` as ElementType;

  return (
    <section
      className={cn(
        "relay-empty",
        fill && "relay-empty--fill",
        className,
      )}
      aria-labelledby={resolvedTitleId}
    >
      {mark ? (
        <span className="relay-bleed-mark" aria-hidden="true">R</span>
      ) : null}
      {marginalia ? (
        <span className="relay-empty-marginalia" aria-hidden="true">
          {marginalia}
        </span>
      ) : null}
      {illustration ? (
        <div className="relay-empty-illustration" aria-hidden="true">
          {illustration}
        </div>
      ) : null}
      {kicker ? <div className="relay-empty-kicker">{kicker}</div> : null}
      <TitleTag
        id={resolvedTitleId}
        className="relay-empty-title"
      >
        {title}
      </TitleTag>
      {body ? (
        <p className="relay-empty-body">{body}</p>
      ) : null}
      {hint ? <p className="relay-empty-hint">{hint}</p> : null}
      {actions ? (
        <div className="relay-empty-actions">{actions}</div>
      ) : null}
    </section>
  );
}
