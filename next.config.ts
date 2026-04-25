import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Pin the workspace root to this project, regardless of any parent lockfiles.
// Without this, when scriptr is checked out as a worktree under a parent repo
// (e.g. .worktrees/<name>), Next.js walks up to the parent's package-lock.json
// and nests `.next/standalone/<...full path...>/server.js` accordingly. We
// need the standalone output flat so electron-builder can ship it.
const projectRoot = dirname(fileURLToPath(import.meta.url));

// When running under Electron with update checks enabled, the main process
// passes SCRIPTR_UPDATES_CHECK=1. We include GitHub releases in connect-src
// only then — keeping the web build's egress surface unchanged.
const updatesEnabled = process.env.SCRIPTR_UPDATES_CHECK === "1";

const connectSrc = ["'self'", "https://api.x.ai"];
if (updatesEnabled) connectSrc.push("https://api.github.com");

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js dev needs inline/eval
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSrc.join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: cspDirectives },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
