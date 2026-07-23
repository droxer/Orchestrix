"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTeams } from "../hooks/useTeams";
import { useUrlSearchState } from "../hooks/useUrlSearchState";
import { selectedTeamForWorkspace } from "../lib/teamWorkspace";
import { teamAvailability } from "../lib/taskAssignment";
import { StatusPill } from "./StatusPill";
import type { CurrentUser } from "../types";
import { ActionAdd } from "./icons";
import { PageHeader } from "./PageHeader";
import { RelayEmptyState } from "./RelayEmptyState";
import { TeamDrawer } from "./admin/TeamDrawer";
import { TeamWorkspacePage } from "./TeamWorkspacePage";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function TeamsPage({
  currentUser,
  isRefreshing,
  onRefresh,
  onOpenConversation,
}: {
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenConversation: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const { teams, isFetching } = useTeams(currentUser.employeeId);
  const [teamId, setTeamId] = useUrlSearchState<string | null>(
    "team",
    null,
    (value) => value,
    (value) => value,
  );
  const [addTeam, setAddTeam] = useUrlSearchState(
    "addTeam",
    false,
    (value) => value === "1",
    (value) => value ? "1" : null,
  );
  const sortedTeams = useMemo(
    () => [...teams].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    [teams],
  );
  const loading = isFetching && teams.length === 0;
  const selectedTeam = selectedTeamForWorkspace(sortedTeams, teamId);

  return (
    <section id="teams-panel" className="teams-page" aria-label={t("teams.title")} tabIndex={-1}>
      <div className="teams-roster">
        <PageHeader
          kicker={t("nav.workspace")}
          title={t("teams.title")}
          count={t("teams.count", { count: teams.length })}
          titleVariant="display"
          layout="stacked"
          actions={(
            <Button type="button" size="sm" onClick={() => setAddTeam(true)}>
              <ActionAdd size={15} aria-hidden="true" />
              <span>{t("teams.add")}</span>
            </Button>
          )}
        />

        <div className="teams-page-body">
          {loading ? (
            <div className="route-loading" role="status" aria-live="polite">{t("admin.loading")}</div>
          ) : sortedTeams.length === 0 ? (
            <RelayEmptyState title={t("teams.empty_title")} body={t("teams.empty_body")} />
          ) : (
            <div className="teams-table" role="table" aria-label={t("teams.title")}>
              <div className="teams-table-head" role="row">
                <span className="teams-table-col" role="columnheader">{t("teams.name")}</span>
                <span className="teams-table-col teams-table-col--status" role="columnheader">{t("teams.col_status")}</span>
              </div>
              <ul className="teams-list" role="rowgroup">
                {sortedTeams.map((team) => {
                  const memberNames = team.members.map((member) => member.displayName).join(", ");
                  return (
                    <li key={team.id} className="teams-list-row" role="row" data-selected={team.id === selectedTeam?.id ? "true" : "false"}>
                      <button
                        type="button"
                        className="teams-list-row-select"
                        aria-current={team.id === selectedTeam?.id ? "page" : undefined}
                        onClick={() => setTeamId(team.id)}
                      >
                        <span className="teams-list-identity" role="cell">
                          <span className="teams-list-title">{team.name}</span>
                          <small className="teams-list-sub">{team.lead?.displayName ?? t("teams.unavailable")} · {memberNames || t("teams.no_members")}</small>
                        </span>
                        <span className="teams-list-status" role="cell">
                          {/* "ready" is the default healthy state and stays
                              implicit; other roster states get named. */}
                          {!team.enabled ? (
                            <Badge variant="neutral">{t("teams.disabled")}</Badge>
                          ) : teamAvailability(team) !== "ready" ? (
                            <StatusPill value={teamAvailability(team)} />
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="teams-detail">
        {selectedTeam ? (
          <TeamWorkspacePage
            key={selectedTeam.id}
            team={selectedTeam}
            employeeId={currentUser.employeeId}
            isRefreshing={isRefreshing}
            onRefresh={onRefresh}
            onOpenConversation={onOpenConversation}
            onDeleted={() => setTeamId(null)}
          />
        ) : (
          <RelayEmptyState fill mark title={t("teams.select_title")} body={t("teams.select_body")} />
        )}
      </div>

      <TeamDrawer
        open={addTeam}
        employeeId={currentUser.employeeId}
        onClose={() => setAddTeam(false)}
      />
    </section>
  );
}
