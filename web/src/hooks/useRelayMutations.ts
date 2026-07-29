"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  assignTask,
  cancelRun,
  createTask,
  createTeam,
  deleteSession,
  deleteTeam,
  deleteTask,
  recordDecision,
  renameSession,
  runSandbox,
  runLogicalAgents,
  startTask,
  updateTask,
  updateTeam,
} from "../api";
import type { AgentRunInput, AgentTaskMode, CreateTaskInput, RelaySession, RelayTask, RunInput, TaskMutationInput, TeamMutationInput } from "../types";
import { RELAY_QUERY_KEY, SESSIONS_QUERY_KEY, TASKS_QUERY_KEY } from "./useRelayData";
import { useMutationError } from "./useMutationError";
import { useDialogs } from "../components/ui/DialogProvider";
import { TEAMS_QUERY_KEY } from "./useTeams";

type TokenArg = { token?: string };

export function useRelayMutations() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { announce } = useDialogs();
  const { reportMutationError } = useMutationError();

  const invalidateRelay = () => queryClient.invalidateQueries({ queryKey: RELAY_QUERY_KEY });
  const invalidateTeams = () => queryClient.invalidateQueries({ queryKey: [TEAMS_QUERY_KEY] });

  const onRelayError = (context: string, messageKey: string) => (error: unknown) => {
    reportMutationError(context, error, t(messageKey));
  };

  const renameSessionMutation = useMutation({
    mutationFn: ({ sessionId, title, token }: { sessionId: string; title: string } & TokenArg) =>
      renameSession(sessionId, title, token),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to rename thread", "errors.rename_thread"),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: ({ sessionId, token }: { sessionId: string } & TokenArg) => deleteSession(sessionId, token),
    onMutate: async ({ sessionId }) => {
      await queryClient.cancelQueries({ queryKey: SESSIONS_QUERY_KEY });
      const previous = queryClient.getQueryData<RelaySession[]>(SESSIONS_QUERY_KEY);
      queryClient.setQueryData<RelaySession[]>(SESSIONS_QUERY_KEY, (current) =>
        (current ?? []).filter((session) => session.id !== sessionId),
      );
      return { previous };
    },
    onSuccess: () => void invalidateRelay(),
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(SESSIONS_QUERY_KEY, context.previous);
      }
      onRelayError("Failed to delete thread", "errors.delete_thread")(error);
    },
  });

  const cancelRunMutation = useMutation({
    mutationFn: ({
      sessionId,
      token,
      reason,
    }: { sessionId: string; reason?: string } & TokenArg) =>
      cancelRun(sessionId, token, reason),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to cancel active run", "errors.cancel_run"),
  });

  const recordDecisionMutation = useMutation({
    mutationFn: ({
      sessionId,
      kind,
      note,
      token,
    }: { sessionId: string; kind: "approve" | "reject" | "mark_done"; note?: string } & TokenArg) =>
      recordDecision(sessionId, kind, note, token),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to record decision", "errors.record_decision"),
  });

  const runSandboxMutation = useMutation({
    mutationFn: ({ input, token }: { input: RunInput; token?: string }) => runSandbox(input, token),
    onSuccess: () => void invalidateRelay(),
  });

  const runLogicalAgentsMutation = useMutation({
    mutationFn: (input: AgentRunInput) => runLogicalAgents(input),
    onSuccess: () => void invalidateRelay(),
  });

  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(input),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to create task", "errors.save_task"),
  });

  // Status is applied to the cache up front so a card dragged between board
  // lanes lands immediately instead of springing back until the PATCH returns.
  // Only status is patched optimistically: it is a plain enum the board reads
  // directly, whereas the drawer's other fields are normalized server-side and
  // their latency is hidden by the drawer closing anyway.
  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: TaskMutationInput }) => updateTask(taskId, input),
    onMutate: async ({ taskId, input }: { taskId: string; input: TaskMutationInput }) => {
      const status = input.status;
      if (!status) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const previous = queryClient.getQueryData<RelayTask[]>(TASKS_QUERY_KEY);
      queryClient.setQueryData<RelayTask[]>(TASKS_QUERY_KEY, (current) =>
        (current ?? []).map((task) => (task.id === taskId ? { ...task, status } : task)),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(TASKS_QUERY_KEY, context.previous);
      onRelayError("Failed to update task", "errors.save_task")(error);
    },
    // Settled, not success: a rolled-back failure must resync from the server
    // too, otherwise the board keeps showing the pre-mutation snapshot.
    onSettled: () => void invalidateRelay(),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: ({ taskId }: { taskId: string }) => deleteTask(taskId),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to delete task", "errors.delete_task"),
  });

  const assignTaskMutation = useMutation({
    mutationFn: ({ taskId, agentId }: { taskId: string; agentId: string }) => assignTask(taskId, agentId),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to assign task", "errors.task_action"),
  });

  const startTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      ...input
    }: {
      taskId: string;
      mode?: AgentTaskMode;
      assignments?: RunInput["assignments"];
    }) => startTask(taskId, input),
    onSuccess: (result) => {
      void invalidateRelay();
      announce({
        message: result.dispatch.message ?? t("backlog.toast_started"),
        tone: result.dispatch.state === "rejected"
          ? "error"
          : result.dispatch.state === "started"
            ? "success"
            : "info",
      });
    },
    onError: onRelayError("Failed to start task", "errors.task_action"),
  });

  const createTeamMutation = useMutation({
    mutationFn: (input: TeamMutationInput) => createTeam(input),
    onSuccess: () => {
      void invalidateTeams();
      void invalidateRelay();
    },
    onError: onRelayError("Failed to create team", "errors.save_team"),
  });

  const updateTeamMutation = useMutation({
    mutationFn: ({ teamId, input }: { teamId: string; input: Partial<TeamMutationInput> }) =>
      updateTeam(teamId, input),
    onSuccess: () => {
      void invalidateTeams();
      void invalidateRelay();
    },
    onError: onRelayError("Failed to update team", "errors.save_team"),
  });

  const deleteTeamMutation = useMutation({
    mutationFn: (teamId: string) => deleteTeam(teamId),
    onSuccess: () => {
      void invalidateTeams();
      void invalidateRelay();
    },
    onError: onRelayError("Failed to delete team", "errors.delete_team"),
  });

  return {
    renameSessionMutation,
    deleteSessionMutation,
    cancelRunMutation,
    recordDecisionMutation,
    runSandboxMutation,
    runLogicalAgentsMutation,
    createTaskMutation,
    updateTaskMutation,
    deleteTaskMutation,
    assignTaskMutation,
    startTaskMutation,
    createTeamMutation,
    updateTeamMutation,
    deleteTeamMutation,
    invalidateRelay,
  };
}

export type RunSandboxMutationResult = RelaySession;
