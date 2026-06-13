import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { listDaemonNodes, listSandboxes, listSessions } from "../api";
import type { DaemonNodeMonitorRecord, RelaySession, SandboxRecord, Tone } from "../types";

type StatusUpdate = { tone: Tone; message: string };

type RelayDataResult = {
  sandboxes: SandboxRecord[];
  nodes: DaemonNodeMonitorRecord[];
  sessions: RelaySession[];
  isRefreshing: boolean;
  refresh: (signal?: AbortSignal, tokenOverride?: string) => Promise<void>;
  setSandboxes: Dispatch<SetStateAction<SandboxRecord[]>>;
};

export function useRelayData(
  setStatus: Dispatch<SetStateAction<StatusUpdate>>,
  token: string | undefined,
  enabled: boolean,
): RelayDataResult {
  const [sandboxes, setSandboxes] = useState<SandboxRecord[]>([]);
  const [nodes, setNodes] = useState<DaemonNodeMonitorRecord[]>([]);
  const [sessions, setSessions] = useState<RelaySession[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal, tokenOverride?: string) => {
      if (!enabled) {
        setSandboxes([]);
        setNodes([]);
        setSessions([]);
        return;
      }
      const requestToken = tokenOverride ?? token;
      setIsRefreshing(true);
      try {
        const [sandboxResult, nodeResult, sessionResult] = await Promise.allSettled([
          requestToken ? listSandboxes(requestToken, signal) : Promise.resolve({ sandboxes: [] }),
          requestToken ? listDaemonNodes(requestToken, signal) : Promise.resolve({ nodes: [] }),
          listSessions(signal),
        ]);
        if (sandboxResult.status === "fulfilled")
          setSandboxes(sandboxResult.value.sandboxes);
        if (nodeResult.status === "fulfilled") setNodes(nodeResult.value.nodes);
        if (sessionResult.status === "fulfilled")
          setSessions(sessionResult.value.sessions);
        const rejected = [sandboxResult, nodeResult, sessionResult].find(
          (item) => item.status === "rejected",
        );
        if (rejected?.status === "rejected") {
          setStatus({
            tone: "warn",
            message:
              rejected.reason instanceof Error
                ? rejected.reason.message
                : String(rejected.reason),
          });
        }
      } finally {
        setIsRefreshing(false);
      }
    },
    [enabled, setStatus, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal), 3000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { sandboxes, nodes, sessions, isRefreshing, refresh, setSandboxes };
}
