import type { RelaySession } from "../types.js";

export type SendAction = { kind: "append"; sessionId: string } | { kind: "create" };

type SessionLike = Pick<RelaySession, "id"> & { archived?: boolean };

export function chooseSendAction(input: {
  activeSessionId: string | null;
  session: SessionLike | undefined;
}): SendAction {
  const { activeSessionId, session } = input;
  if (activeSessionId && session && !session.archived) {
    return { kind: "append", sessionId: activeSessionId };
  }
  return { kind: "create" };
}
