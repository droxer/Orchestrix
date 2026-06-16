import { create } from "zustand";
import type { Tone } from "../types";
import { writeTokens, type TokenMap } from "./appStorage";

export interface StatusMessage {
  tone: Tone;
  message: string;
}

// Cross-cutting client state for the main app shell: which employee/session is
// open, the per-employee/sandbox auth tokens, and the transient status/toast.
// Server state stays in TanStack Query; this store is only the local selection
// + UI state that was previously threaded through App's useState + props.
interface RelayClientStore {
  selectedEmployee: string;
  selectedSessionId: string | undefined;
  tokens: TokenMap;
  status: StatusMessage;

  setSelectedEmployee: (id: string) => void;
  setSelectedSessionId: (id: string | undefined) => void;
  // Persists to localStorage so callers no longer pair set + write by hand.
  setTokens: (tokens: TokenMap) => void;
  setStatus: (status: StatusMessage) => void;
}

export const useRelayStore = create<RelayClientStore>((set) => ({
  selectedEmployee: "",
  selectedSessionId: undefined,
  tokens: {},
  status: { tone: "info", message: "" },

  setSelectedEmployee: (selectedEmployee) => set({ selectedEmployee }),
  setSelectedSessionId: (selectedSessionId) => set({ selectedSessionId }),
  setTokens: (tokens) => {
    writeTokens(tokens);
    set({ tokens });
  },
  setStatus: (status) => set({ status }),
}));
