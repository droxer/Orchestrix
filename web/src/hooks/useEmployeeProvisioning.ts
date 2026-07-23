import { useCallback, type Dispatch, type SetStateAction } from "react";
import { provisionSandbox, RelayApiError } from "../api";
import type { ControlPanelDaemonNodeRecord, DaemonNodeMonitorRecord, SandboxRecord } from "../types";
import { newBrowserSandboxToken, preferLocalControlPanelNode } from "../lib/controlPanel";
import { shouldClaimLocalDaemonNode } from "../lib/daemonNodes";
import { useRelayStore } from "../lib/store";

// Sandbox provisioning + local-node adoption. Reads selection/tokens/status
// straight from the Zustand store; the server-state pieces it can't own
// (authenticated nodes, the sandbox list setter, and the refresh callbacks)
// are injected by the host.
export function useEmployeeProvisioning({ nodes, setSandboxes, refreshLocalDaemonNodes, refreshWithToken }: {
  nodes: DaemonNodeMonitorRecord[];
  setSandboxes: Dispatch<SetStateAction<SandboxRecord[]>>;
  refreshLocalDaemonNodes: () => Promise<ControlPanelDaemonNodeRecord[]>;
  refreshWithToken: (tokenOverride?: string) => Promise<void>;
}): {
  provisionEmployeeSandbox: (employeeId: string, preferredToken?: string) => Promise<{ sandbox: SandboxRecord; token?: string }>;
  rememberSandboxToken: (employeeId: string, sandbox: SandboxRecord, token?: string) => void;
  adoptLocalDaemonNodes: () => Promise<void>;
} {
  const tokens = useRelayStore((s) => s.tokens);
  const selectedEmployee = useRelayStore((s) => s.selectedEmployee);
  const setTokens = useRelayStore((s) => s.setTokens);

  async function provisionEmployeeSandbox(
    employeeId: string,
    preferredToken?: string,
  ): Promise<{ sandbox: SandboxRecord; token?: string }> {
    const token = preferredToken?.trim() || undefined;
    const controlPanelNodes = (await refreshLocalDaemonNodes()) ?? [];
    const localNode = preferLocalControlPanelNode(employeeId, controlPanelNodes);

    const claimLocalNode = async () => {
      if (!localNode?.nodeToken) return undefined;
      const nextToken = newBrowserSandboxToken();
      const sandbox = await provisionSandbox(employeeId, nextToken, localNode.nodeToken);
      return { sandbox, token: nextToken };
    };

    if (token) {
      try {
        const sandbox = await provisionSandbox(employeeId, token);
        return { sandbox, token: sandbox.token ?? token };
      } catch (error) {
        if (error instanceof RelayApiError && error.status === 401) {
          const claimed = await claimLocalNode();
          if (claimed) return claimed;
        }
        throw error;
      }
    }

    const claimed = await claimLocalNode();
    if (claimed) return claimed;

    const sandbox = await provisionSandbox(employeeId, token);
    return { sandbox, token: sandbox.token ?? token };
  }

  function rememberSandboxToken(employeeId: string, sandbox: SandboxRecord, token?: string): void {
    if (token) {
      setTokens({ ...tokens, [employeeId]: token, [sandbox.id]: token });
    }
    setSandboxes((cur) => [sandbox, ...cur.filter((s) => s.id !== sandbox.id)]);
  }

  const adoptLocalDaemonNodes = useCallback(async () => {
    const controlPanelNodes = (await refreshLocalDaemonNodes()) ?? [];
    const claimable = controlPanelNodes.filter((node) => shouldClaimLocalDaemonNode(node, nodes));
    if (claimable.length === 0) return;

    const nextTokens = { ...tokens };
    const adoptedSandboxes: SandboxRecord[] = [];
    for (const node of claimable) {
      if (!node.employeeId || !node.nodeToken) continue;
      const uiToken = newBrowserSandboxToken();
      try {
        const sandbox = await provisionSandbox(node.employeeId, uiToken, node.nodeToken);
        nextTokens[node.employeeId] = uiToken;
        nextTokens[sandbox.id] = uiToken;
        adoptedSandboxes.push(sandbox);
      } catch {
        // A node may already belong to another browser token; leave it untouched.
      }
    }

    if (adoptedSandboxes.length === 0) return;
    setTokens(nextTokens);
    setSandboxes((cur) => [
      ...adoptedSandboxes,
      ...cur.filter((sandbox) => !adoptedSandboxes.some((adopted) => adopted.id === sandbox.id)),
    ]);
    await refreshWithToken(nextTokens[selectedEmployee] ?? nextTokens[adoptedSandboxes[0].id]);
  }, [nodes, refreshLocalDaemonNodes, refreshWithToken, selectedEmployee, setSandboxes, setTokens, tokens]);

  return { provisionEmployeeSandbox, rememberSandboxToken, adoptLocalDaemonNodes };
}
