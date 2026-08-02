import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  count,
  kicker,
  subtitle,
  toolbar,
  actions,
  titleVariant = "default",
  layout = "inline",
}: {
  title: ReactNode;
  count?: ReactNode;
  kicker?: ReactNode;
  subtitle?: ReactNode;
  toolbar?: ReactNode;
  actions?: ReactNode;
  titleVariant?: "default" | "display";
  layout?: "inline" | "stacked";
}) {
  const stacked = layout === "stacked";

  return (
    <header
      className={cn(
        "page-header surface-header",
        stacked ? "page-header--stacked" : "page-header--inline",
      )}
    >
      <div className={cn("page-header-lead", stacked && "page-header-lead--stacked")}>
        {kicker ? <span className="page-header-kicker">{kicker}</span> : null}
        <div className={cn("page-header-title-row", stacked && "page-header-title-row--wrap")}>
          <h1
            className={cn(
              "page-header-title",
              titleVariant === "display"
                ? "page-header-title--display"
                : "page-header-title--inline",
            )}
          >
            {title}
          </h1>
          {count != null ? (
            <span className="page-header-count">{count}</span>
          ) : null}
        </div>
        {subtitle ? <p className="page-header-subtitle">{subtitle}</p> : null}
        {toolbar ? <div className="page-header-toolbar">{toolbar}</div> : null}
      </div>
      {actions ? (
        <div className={cn("page-header-actions", stacked && "page-header-actions--stacked")}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
