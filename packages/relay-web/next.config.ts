import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const backendUrl = process.env.RELAY_BACKEND_URL ?? process.env.RELAY_DAEMON_URL ?? "http://127.0.0.1:8790";

const nextConfig = (phase: string): NextConfig => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    basePath: "/web",
    ...(!isDev ? { output: "export" as const } : {}),
    ...(isDev
      ? {
          async redirects() {
            return [
              { source: "/", destination: "/web", permanent: false, basePath: false },
              { source: "/login", destination: "/web", permanent: false, basePath: false },
              { source: "/channels", destination: "/web", permanent: false, basePath: false },
            ];
          },
          async rewrites() {
            return [
              { source: "/cp", destination: `${backendUrl}/cp`, basePath: false },
              { source: "/cp/:path*", destination: `${backendUrl}/cp/:path*`, basePath: false },
              { source: "/sandboxes/:path*", destination: `${backendUrl}/sandboxes/:path*`, basePath: false },
              { source: "/sessions/:path*", destination: `${backendUrl}/sessions/:path*`, basePath: false },
              { source: "/daemon-nodes/:path*", destination: `${backendUrl}/daemon-nodes/:path*`, basePath: false },
              { source: "/tasks/:path*", destination: `${backendUrl}/tasks/:path*`, basePath: false },
            ];
          },
        }
      : {}),
  };
};

export default nextConfig;
