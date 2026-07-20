"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  archiveSession,
  assignTask,
  cancelRun,
  createTask,
  deleteTask,
  recordDecision,
  renameSession,
  runSandbox,
  runLogicalAgents,
  startTask,
  updateTask,
} from "../api";
import type { AgentName, AgentRunInput, AgentTaskMode, CreateTaskInput, RelaySession, RunInput, TaskMutationInput } from "../types";
import { RELAY_QUERY_KEY } from "./useRelayData";
import { useMutationError } from "./useMutationError";

type TokenArg = { token?: string };

export function useRelayMutations() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { reportMutationError } = useMutationError();

  const invalidateRelay = () => queryClient.invalidateQueries({ queryKey: RELAY_QUERY_KEY });

  const onRelayError = (context: string, messageKey: string) => (error: unknown) => {
    reportMutationError(context, error, t(messageKey));
  };

  const renameSessionMutation = useMutation({
    mutationFn: ({ sessionId, title, token }: { sessionId: string; title: string } & TokenArg) =>
      renameSession(sessionId, title, token),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to rename conversation", "errors.rename_conversation"),
  });

  const archiveSessionMutation = useMutation({
    mutationFn: ({ sessionId, token }: { sessionId: string } & TokenArg) => archiveSession(sessionId, token),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to archive conversation", "errors.archive_conversation"),
  });

  const cancelRunMutation = useMutation({
    mutationFn: ({
      sandboxId,
      sessionId,
      token,
      reason,
    }: { sandboxId: string; sessionId: string; reason?: string } & TokenArg) =>
      cancelRun(sandboxId, sessionId, token, reason),
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

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: TaskMutationInput }) => updateTask(taskId, input),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to update task", "errors.save_task"),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: ({ taskId }: { taskId: string }) => deleteTask(taskId),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to delete task", "errors.delete_task"),
  });

  const assignTaskMutation = useMutation({
    mutationFn: ({ taskId, agent }: { taskId: string; agent: AgentName }) => assignTask(taskId, agent),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to assign task", "errors.task_action"),
  });

  const startTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      ...input
    }: {
      taskId: string;
      agent?: AgentName;
      mode?: AgentTaskMode;
      assignments?: RunInput["assignments"];
    }) => startTask(taskId, input),
    onSuccess: () => void invalidateRelay(),
    onError: onRelayError("Failed to start task", "errors.task_action"),
  });

  return {
    renameSessionMutation,
    archiveSessionMutation,
    cancelRunMutation,
    recordDecisionMutation,
    runSandboxMutation,
    runLogicalAgentsMutation,
    createTaskMutation,
    updateTaskMutation,
    deleteTaskMutation,
    assignTaskMutation,
    startTaskMutation,
    invalidateRelay,
  };
}

export type RunSandboxMutationResult = RelaySession;
