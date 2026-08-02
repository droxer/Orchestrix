import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const backendUrl = process.env.RELAY_BACKEND_URL ?? process.env.RELAY_DAEMON_URL ?? "http://127.0.0.1:8790";

const nextConfig = (phase: string): NextConfig => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    ...(!isDev ? { output: "export" as const } : {}),
    ...(isDev
      ? {
          // Suppress the Next dev-mode indicator badge: it renders fixed at the
          // bottom-left corner and overlaps the SideNav "Settings" control. It
          // never ships (production uses `output: "export"`), so hiding it only
          // affects local dev ergonomics.
          devIndicators: false,
          async rewrites() {
            return {
              beforeFiles: [
                { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
                { source: "/profile-images/:path*", destination: `${backendUrl}/profile-images/:path*` },
              ],
              fallback: [
                { source: "/login", destination: "/" },
                { source: "/threads", destination: "/" },
                { source: "/threads/:path*", destination: "/" },
                { source: "/backlog", destination: "/" },
                { source: "/computer", destination: "/" },
                { source: "/routines", destination: "/" },
                { source: "/agents", destination: "/" },
                { source: "/agents/:path*", destination: "/" },
                { source: "/teams", destination: "/" },
                { source: "/teams/:path*", destination: "/" },
                { source: "/channels", destination: "/" },
                { source: "/admin", destination: "/" },
                { source: "/admin/:path*", destination: "/" },
              ],
            };
          },
        }
      : {}),
  };
};

export default nextConfig;
