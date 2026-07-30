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
import { TeamMark } from "./TeamMark";
import { ProfileImage } from "./ProfileImagePicker";
import { TeamDrawer } from "./admin/TeamDrawer";
import { TeamWorkspacePage } from "./TeamWorkspacePage";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

export function TeamsPage({
  currentUser,
  isRefreshing,
  onRefresh,
  onOpenThread,
  teamId,
  onSelectTeam,
}: {
  currentUser: CurrentUser;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenThread: (sessionId: string) => void;
  teamId: string | null;
  onSelectTeam: (teamId: string | null) => void;
}) {
  const { t } = useTranslation();
  const { teams, isFetching } = useTeams(currentUser.employeeId);
  const [addTeam, setAddTeam] = useUrlSearchState(
    "dialog",
    false,
    (value) => value === "create",
    (value) => value ? "create" : null,
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
          actions={teamId ? null : (
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
            <Table
              className="teams-table"
              columns="minmax(0, 1fr) auto"
              aria-label={t("teams.title")}
            >
              <TableHeader>
                <TableHead>{t("teams.name")}</TableHead>
                <TableHead className="text-right">{t("teams.col_status")}</TableHead>
              </TableHeader>
              <TableBody render={<ul className="teams-list" />}>
                {sortedTeams.map((team) => {
                  const memberNames = team.members.map((member) => member.displayName).join(", ");
                  return (
                    <TableRow key={team.id} render={<li />} className="teams-list-row" data-selected={team.id === selectedTeam?.id ? "true" : "false"}>
                      <button
                        type="button"
                        className="teams-list-row-select"
                        aria-current={team.id === selectedTeam?.id ? "page" : undefined}
                        onClick={() => onSelectTeam(team.id)}
                      >
                        <span className="teams-list-mark" aria-hidden="true">
                          <ProfileImage
                            src={team.profileImageUrl}
                            alt=""
                            fallback={<TeamMark size={16} />}
                          />
                        </span>
                        <TableCell render={<span />} className="teams-list-identity">
                          <span className="teams-list-title">{team.name}</span>
                          <small className="teams-list-sub">{team.lead?.displayName ?? t("teams.unavailable")} · {memberNames || t("teams.no_members")}</small>
                        </TableCell>
                        <TableCell render={<span />} className="teams-list-status">
                          {/* "ready" is the default healthy state and stays
                              implicit; other roster states get named. */}
                          {!team.enabled ? (
                            <Badge variant="neutral">{t("teams.disabled")}</Badge>
                          ) : teamAvailability(team) !== "ready" ? (
                            <StatusPill value={teamAvailability(team)} />
                          ) : null}
                        </TableCell>
                      </button>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
            onOpenThread={onOpenThread}
            onDeleted={() => onSelectTeam(null)}
          />
        ) : (
          <RelayEmptyState fill mark title={t("teams.select_title")} body={t("teams.select_body")} />
        )}
      </div>

      <TeamDrawer
        open={!teamId && addTeam}
        employeeId={currentUser.employeeId}
        onClose={() => setAddTeam(false)}
      />
    </section>
  );
}
