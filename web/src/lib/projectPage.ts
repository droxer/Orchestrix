import type { EmployeeAgent, ProjectMember, ProjectRecord } from "../types.js";

export type ProjectPageTab = "profile" | "workspace" | "activities";
export type ProjectCollectionStatus = "loading" | "error" | "ready";
export type ProjectOverviewState = "hidden" | "loading" | "error" | "not-found" | "ready";

export const PROJECT_PAGE_TABS: readonly ProjectPageTab[] = ["profile", "workspace", "activities"];

export function parseProjectPageTab(value: string | null): ProjectPageTab {
  return PROJECT_PAGE_TABS.includes(value as ProjectPageTab)
    ? value as ProjectPageTab
    : "profile";
}

export function projectPageTabForKey(
  current: ProjectPageTab,
  key: string,
): ProjectPageTab | null {
  const currentIndex = PROJECT_PAGE_TABS.indexOf(current);
  if (key === "Home") return PROJECT_PAGE_TABS[0];
  if (key === "End") return PROJECT_PAGE_TABS.at(-1)!;
  if (key === "ArrowLeft") {
    return PROJECT_PAGE_TABS[currentIndex - 1] ?? PROJECT_PAGE_TABS.at(-1)!;
  }
  if (key === "ArrowRight") {
    return PROJECT_PAGE_TABS[currentIndex + 1] ?? PROJECT_PAGE_TABS[0];
  }
  return null;
}

export function orderedProjectMembers(project: ProjectRecord): ProjectMember[] {
  return [
    ...project.members.filter((member) => member.agentId === project.leadAgentId),
    ...project.members.filter((member) => member.agentId !== project.leadAgentId),
  ];
}

export function projectMemberState(member: ProjectMember, agent?: EmployeeAgent) {
  const available = Boolean(agent && !agent.deletedAt);
  return {
    available,
    enabled: member.enabled && Boolean(agent?.enabled) && available,
    availability: available ? agent?.availability ?? "offline" : "offline",
  } as const;
}

export function projectPageActions(project: ProjectRecord) {
  return {
    settings: true,
    newThread: !project.archivedAt && project.enabled,
  } as const;
}

export function resolveProjectOverviewState({
  showProjectOverview,
  project,
  collectionStatus,
}: {
  showProjectOverview: boolean;
  project: ProjectRecord | null;
  collectionStatus: ProjectCollectionStatus;
}): ProjectOverviewState {
  if (!showProjectOverview) return "hidden";
  if (project) return "ready";
  if (collectionStatus === "loading") return "loading";
  if (collectionStatus === "error") return "error";
  return "not-found";
}

export function showThreadChrome(showProjectOverview: boolean): boolean {
  return !showProjectOverview;
}

export function projectActivitiesState({
  isLoading,
  hasData,
  hasError,
}: {
  isLoading: boolean;
  hasData: boolean;
  hasError: boolean;
}): "loading" | "error" | "ready" {
  if (isLoading && !hasData) return "loading";
  if (hasError || !hasData) return "error";
  return "ready";
}
