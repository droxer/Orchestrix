import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const daemonUrl = process.env.RELAY_DAEMON_URL ?? "http://127.0.0.1:8790";

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
              { source: "/cp", destination: `${daemonUrl}/cp`, basePath: false },
              { source: "/cp/:path*", destination: `${daemonUrl}/cp/:path*`, basePath: false },
              { source: "/sandboxes/:path*", destination: `${daemonUrl}/sandboxes/:path*`, basePath: false },
              { source: "/sessions/:path*", destination: `${daemonUrl}/sessions/:path*`, basePath: false },
              { source: "/daemon-nodes/:path*", destination: `${daemonUrl}/daemon-nodes/:path*`, basePath: false },
              { source: "/tasks/:path*", destination: `${daemonUrl}/tasks/:path*`, basePath: false },
            ];
          },
        }
      : {}),
  };
};

export default nextConfig;
