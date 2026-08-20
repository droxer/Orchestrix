"use client";

import { useEffect, useMemo, useRef } from "react";
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
import { IdentityMark } from "./IdentityMark";
import { ProfileImage } from "./ProfileImagePicker";
import { TeamDrawer } from "./admin/TeamDrawer";
import { TeamWorkspacePage } from "./TeamWorkspacePage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function TeamsPage({
  currentUser,
  onOpenThread,
  teamId,
  onSelectTeam,
}: {
  currentUser: CurrentUser;
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
  const selectedRowRef = useRef<HTMLLIElement>(null);

  /* The roster is a bounded scroll region (46vh once it stacks above the
     detail). Deep-linking to a team otherwise lands with its row clipped to a
     sliver at the bottom edge. */
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedTeam?.id]);

  return (
    <section id="teams-panel" className="teams-page" aria-label={t("teams.title")} tabIndex={-1}>
      <div className="teams-roster">
        <PageHeader
          kicker={t("nav.workforce")}
          title={t("teams.title")}
          count={t("teams.count", { count: teams.length })}
          titleVariant="display"
          layout="stacked"
          actions={(
            // The shared list-header create affordance — a ghost plus, same
            // as the projects/threads rail.
            <Button
              variant="ghost"
              type="button"
              className="page-header-icon-action"
              aria-label={t("teams.add")}
              title={t("teams.add")}
              onClick={() => setAddTeam(true)}
            >
              <ActionAdd size={16} aria-hidden="true" />
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
              // A roster table is a dense list surface: names drop to 15px and
              // the member sub-line to 13px, matching the agent roster rail.
              data-density="compact"
            >
              <TableHeader>
                <TableHead>{t("teams.name")}</TableHead>
                <TableHead className="text-right">{t("teams.col_status")}</TableHead>
              </TableHeader>
              <TableBody render={<ul className="teams-list" />}>
                {sortedTeams.map((team) => {
                  // Lead first, then the rest of the crew. Listing every member
                  // after the lead printed the lead's name twice on every row.
                  const supportNames = team.members
                    .filter((member) => member.id !== team.leadAgentId)
                    .map((member) => member.displayName)
                    .join(", ");
                  const roster = team.lead?.displayName
                    ? [team.lead.displayName, supportNames].filter(Boolean).join(" · ")
                    : supportNames || t("teams.no_members");
                  return (
                    <TableRow
                      key={team.id}
                      render={<li ref={team.id === selectedTeam?.id ? selectedRowRef : undefined} />}
                      className="teams-list-row"
                      data-selected={team.id === selectedTeam?.id ? "true" : "false"}
                    >
                      <Button
                        variant="ghost"
                        type="button"
                        className="teams-list-row-select"
                        aria-current={team.id === selectedTeam?.id ? "page" : undefined}
                        onClick={() => onSelectTeam(team.id)}
                      >
                        <span className="teams-list-mark" aria-hidden="true">
                          <ProfileImage
                            src={team.profileImageUrl}
                            alt=""
                            fallback={<IdentityMark kind="team" />}
                          />
                        </span>
                        <TableCell render={<span />} className="teams-list-identity">
                          <span className="teams-list-title">{team.name}</span>
                          <small className="teams-list-sub">{roster}</small>
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
                      </Button>
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
