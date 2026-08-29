import { useId, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The shared zero-data surface: optional mark tile, title, one line of body,
 *  optional hint and actions. There is no decorative layer — see the header
 *  of styles/empty-state.css for why the plate/doodle/watermark furniture is
 *  gone. */
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
  fill?: boolean;
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
  fill = false,
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
