import { useQuery } from "@tanstack/react-query";

import { readArtifactText } from "../api";

/**
 * Loads an artifact body, cached by (session, artifact) so the inline chip's
 * stat derivation and the full viewer drawer share a single fetch. The body is
 * immutable once written, so it never needs refetching within a session.
 */
export function useArtifactBody(
  sessionId: string,
  artifactId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["artifact", sessionId, artifactId],
    queryFn: ({ signal }) => readArtifactText(sessionId, artifactId, signal),
    enabled: options.enabled ?? true,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}
