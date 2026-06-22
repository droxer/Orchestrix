"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useAgentInventoryNodes } from "../hooks/useAgentInventory";
import { aggregateSkillsByAgent, totalItemCount } from "../lib/agentInventory";
import type { AgentName, DaemonAgentSkill } from "../types";

// ── Sub-components ────────────────────────────────────────────────────────────

function SkillRow({ skill }: { skill: DaemonAgentSkill }) {
  return (
    <div className="flex items-baseline gap-base rounded-sm py-xs pr-0 pl-lg transition-[background] duration-[120ms] hover:-mx-xs hover:bg-surface-soft hover:pr-xs hover:pl-[calc(var(--space-lg)+var(--space-xs))]">
      <div className="flex min-w-0 flex-1 flex-col gap-xxs">
        <span className="mono truncate text-sm font-semibold text-ink">{skill.name}</span>
        {skill.description && (
          <p className="truncate text-sm leading-[1.4] text-body">{skill.description}</p>
        )}
      </div>
      {skill.namespace && (
        <span className="mono shrink-0 whitespace-nowrap text-xs font-medium text-muted-soft">{skill.namespace}</span>
      )}
    </div>
  );
}

function AgentGroup({ agent, skills }: { agent: AgentName; skills: DaemonAgentSkill[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="border-b border-hairline-soft last:border-b-0">
      <button
        className="flex w-full items-center gap-sm py-sm text-left transition-opacity duration-[120ms] hover:opacity-75"
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center text-md leading-none text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] data-[collapsed=false]:rotate-90"
          data-collapsed={collapsed}
          aria-hidden="true"
        >
          ›
        </span>
        <span className="flex-1 text-base font-semibold text-ink" translate="no">
          {agent}
        </span>
        <span className="mono text-xs font-medium text-muted-foreground">{skills.length}</span>
      </button>
      {!collapsed && (
        <div className="pb-sm">
          {skills.length === 0 ? (
            <p className="py-xs pl-lg text-sm text-muted-soft">{t("skills.agent_empty")}</p>
          ) : (
            skills.map((skill) => <SkillRow key={`${skill.namespace ?? ""}/${skill.name}`} skill={skill} />)
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-[440px] flex-col items-center gap-md px-xl py-xxl text-center">
      {query ? (
        <>
          <p className="text-lg font-semibold text-ink">{t("skills.no_match_title", { query })}</p>
          <p className="text-sm leading-loose text-body">{t("skills.no_match_body")}</p>
        </>
      ) : (
        <>
          <div className="text-muted-soft" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path d="M24 8l3.5 7 7.5 1-5.5 5.5 1.3 7.5L24 26l-6.8 3 1.3-7.5L13 16l7.5-1L24 8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M12 32l2 8M36 32l-2 8M18 40h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-ink">{t("skills.no_skills_title")}</p>
          <p className="text-sm leading-loose text-body">{t("skills.no_skills_body")}</p>
        </>
      )}
    </div>
  );
}

// ── SkillsPage ────────────────────────────────────────────────────────────────

export function SkillsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { nodes } = useAgentInventoryNodes();

  const groups = useMemo(() => aggregateSkillsByAgent(nodes), [nodes]);
  const total = totalItemCount(groups);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.map((group) => ({
      ...group,
      items: group.items.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.namespace?.toLowerCase().includes(q) ||
          group.agent.toLowerCase().includes(q),
      ),
    }));
  }, [query, groups]);

  const visibleGroups = query.trim() ? filtered.filter((group) => group.items.length > 0) : filtered;
  const hasResults = totalItemCount(visibleGroups) > 0;

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-background">
      <header className="flex min-h-[var(--header-h)] shrink-0 items-center justify-between gap-base border-b border-hairline px-xl max-[820px]:px-base">
        <div className="flex items-baseline gap-sm">
          <h1 className="text-lg font-semibold leading-[1.25] text-balance text-ink">{t("skills.title")}</h1>
          <span className="mono text-xs font-medium text-muted-foreground">{t("skills.sub")}</span>
        </div>
        <div className="flex items-center gap-sm">
          <span className="mono text-xs font-medium text-muted-foreground">{t("skills.total", { count: total })}</span>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-xs border-b border-hairline bg-background px-xl py-sm max-[820px]:px-base focus-within:[outline:2px_solid_var(--color-primary)] focus-within:[outline-offset:-2px]">
        <svg className="shrink-0 text-muted-soft" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.25" />
          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
        <Input
          className="h-auto flex-1 rounded-none border-none bg-transparent px-0 py-0 text-base leading-normal text-ink placeholder:text-muted-soft focus-visible:border-transparent focus-visible:ring-0 [&::-webkit-search-cancel-button]:hidden"
          type="search"
          placeholder={t("skills.search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("skills.search_label")}
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-strong text-base leading-none text-muted-foreground transition-[background,color] duration-[120ms] hover:bg-hairline hover:text-ink"
            type="button"
            aria-label={t("skills.clear_search")}
            onClick={() => setQuery("")}
          >
            ×
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-xl py-base max-[820px]:px-base">
        {total === 0 || !hasResults ? (
          <EmptyState query={query} />
        ) : (
          visibleGroups.map((group) => (
            <AgentGroup key={group.agent} agent={group.agent} skills={group.items} />
          ))
        )}
      </div>
    </section>
  );
}
