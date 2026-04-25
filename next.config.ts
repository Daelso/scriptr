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
if (updatesEnabled) {
  // electron-updater walks api.github.com → github.com (redirect target) →
  // objects.githubusercontent.com (artifact CDN). All three need CSP.
  connectSrc.push("https://api.github.com", "https://github.com", "https://objects.githubusercontent.com");
}

// `unsafe-eval` is needed for Next.js dev server (HMR / fast refresh) but
// never for the production bundle. Dropping it in prod removes the most
// abused script-injection sink.
const isProd = process.env.NODE_ENV === "production";
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const cspDirectives = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSrc.join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // worker-src defaults to script-src — which permits 'unsafe-inline' here.
  // Pin it tighter so a compromised renderer can't `new Worker(blobUrl)`
  // and inherit looser script policy.
  "worker-src 'self'",
  // object-src 'none' kills <object>/<embed>/<applet> as plugin sinks.
  "object-src 'none'",
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
