import { useId, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type RelayEmptyStateProps = {
  title: string;
  body?: string;
  hint?: string;
  illustration?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId?: string;
  /** Heading level for the title (default 2). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  mark?: boolean;
  fill?: boolean;
  animate?: boolean;
};

export function RelayEmptyState({
  title,
  body,
  hint,
  illustration,
  actions,
  className,
  titleId,
  headingLevel = 2,
  mark = false,
  fill = false,
  animate = true,
}: RelayEmptyStateProps) {
  const generatedTitleId = useId();
  const resolvedTitleId = titleId ?? generatedTitleId;
  const TitleTag = `h${headingLevel}` as ElementType;
  const enter = (step: 1 | 2 | 3 | 4) =>
    animate ? `relay-enter relay-enter-delay-${step}` : "";

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
      {illustration ? (
        <div className={cn("relay-empty-illustration", enter(1))} aria-hidden="true">
          {illustration}
        </div>
      ) : null}
      <TitleTag
        id={resolvedTitleId}
        className={cn("relay-empty-title", enter(illustration ? 2 : 1))}
      >
        {title}
      </TitleTag>
      {body ? (
        <p className={cn("relay-empty-body", enter(2))}>{body}</p>
      ) : null}
      {hint ? <p className={cn("relay-empty-hint", enter(3))}>{hint}</p> : null}
      {actions ? (
        <div className={cn("relay-empty-actions", enter(4))}>{actions}</div>
      ) : null}
    </section>
  );
}
