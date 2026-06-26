import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const backendUrl = process.env.RELAY_BACKEND_URL ?? process.env.RELAY_DAEMON_URL ?? "http://127.0.0.1:8790";

const nextConfig = (phase: string): NextConfig => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    ...(!isDev ? { output: "export" as const } : {}),
    ...(isDev
      ? {
          // The app is a single-page client app (only src/app/page.tsx). In
          // production the backend serves index.html for any unmatched path, so
          // client-side views like /login and /channels resolve. Next dev has no
          // SPA fallback, so redirect those direct URLs to the app home.
          async redirects() {
            return [
              { source: "/login", destination: "/", permanent: false },
              { source: "/channels", destination: "/", permanent: false },
            ];
          },
          async rewrites() {
            return [
              { source: "/auth/:path*", destination: `${backendUrl}/auth/:path*` },
              { source: "/cp", destination: `${backendUrl}/cp` },
              { source: "/cp/:path*", destination: `${backendUrl}/cp/:path*` },
              { source: "/sandboxes/:path*", destination: `${backendUrl}/sandboxes/:path*` },
              { source: "/sessions/:path*", destination: `${backendUrl}/sessions/:path*` },
              { source: "/daemon-nodes/:path*", destination: `${backendUrl}/daemon-nodes/:path*` },
              { source: "/tasks/:path*", destination: `${backendUrl}/tasks/:path*` },
            ];
          },
        }
      : {}),
  };
};

export default nextConfig;
