"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { ActionSearch } from "./icons";

interface FiltersBarProps {
  ariaLabel: string;
  searchName: string;
  searchLabel: string;
  query: string;
  onQueryChange: (value: string) => void;
  activeCount: number;
  onClear: () => void;
  /** Page-specific filter controls, revealed when the bar is expanded. */
  children?: ReactNode;
}

export function FiltersBar({
  ariaLabel,
  searchName,
  searchLabel,
  query,
  onQueryChange,
  activeCount,
  onClear,
  children,
}: FiltersBarProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="backlog-filter-bar" role="group" aria-label={ariaLabel}>
      <div className="backlog-filter-primary">
        <div className="backlog-filter-search-wrap">
          <ActionSearch size={15} aria-hidden="true" />
          <input
            className="backlog-filter-search"
            name={searchName}
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={searchLabel}
            aria-label={searchLabel}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <div className="backlog-filter-actions">
          <Button variant="ghost"
            type="button"
            className="backlog-filter-chip"
            data-active={expanded ? "true" : "false"}
            data-applied={activeCount > 0 ? "true" : "false"}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t("backlog.hide_filters") : t("backlog.show_filters")}
            {activeCount > 0 ? (
              <span className="backlog-filter-count" aria-hidden="true">{activeCount}</span>
            ) : null}
          </Button>
          {activeCount > 0 ? (
            <Button variant="ghost"
              type="button"
              className="backlog-filter-clear"
              onClick={onClear}
            >
              {t("backlog.clear_filters")}
            </Button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="backlog-filter-secondary">{children}</div>
      ) : null}
    </div>
  );
}
