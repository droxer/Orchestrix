"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Single QueryClient for the SPA. Created in state so it survives re-renders
// but is never shared across requests (irrelevant under static export, but the
// correct Next.js pattern). Defaults are tuned for an operational console:
// polling lives on each query's refetchInterval, and we avoid surprise
// refetches that would fight the live data already on screen.
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
