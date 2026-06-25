import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type RelayEmptyStateProps = {
  title: string;
  body?: string;
  hint?: string;
  illustration?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId?: string;
  atmosphere?: boolean;
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
  titleId = "relay-empty-title",
  atmosphere = false,
  fill = false,
  animate = true,
}: RelayEmptyStateProps) {
  const enter = (step: 1 | 2 | 3 | 4) =>
    animate ? `relay-enter relay-enter-delay-${step}` : "";

  return (
    <section
      className={cn(
        "relay-empty",
        atmosphere && "relay-empty--atmosphere relay-atmosphere",
        fill && "relay-empty--fill",
        className,
      )}
      aria-labelledby={titleId}
    >
      {illustration ? (
        <div className={cn("relay-empty-illustration", enter(1))} aria-hidden="true">
          {illustration}
        </div>
      ) : null}
      <h2
        id={titleId}
        className={cn("relay-empty-title", enter(illustration ? 2 : 1))}
      >
        {title}
      </h2>
      {body ? (
        <p className={cn("relay-empty-body", enter(illustration ? 2 : 2))}>{body}</p>
      ) : null}
      {hint ? <p className={cn("relay-empty-hint", enter(3))}>{hint}</p> : null}
      {actions ? (
        <div className={cn("relay-empty-actions", enter(4))}>{actions}</div>
      ) : null}
    </section>
  );
}
