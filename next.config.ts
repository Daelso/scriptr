import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Pin the workspace root to this project, regardless of any parent lockfiles.
// Without this, when scriptr is checked out as a worktree under a parent repo
// (e.g. .worktrees/<name>), Next.js walks up to the parent's package-lock.json
// and nests `.next/standalone/<...full path...>/server.js` accordingly. We
// need the standalone output flat so electron-builder can ship it.
const projectRoot = dirname(fileURLToPath(import.meta.url));

// CSP `connect-src` only governs renderer-originated requests. Update
// checks run in the Electron main process via Node's https, never the
// renderer's fetch, so GitHub doesn't belong here. Main-process egress
// is gated by electron/network-filter.ts (UPDATE_HOSTS).
const connectSrc = ["'self'", "https://api.x.ai"];

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
  // sharp 0.34+ ships libvips DLLs as siblings of the .node file in
  // node_modules/@img/sharp-win32-x64/lib/ with no package.json or require()
  // reference — so Next's NFT trace includes the .node but not the DLLs, and
  // dlopen fails on Windows with ERR_DLOPEN_FAILED. Linux/macOS get their
  // libvips through the separate sharp-libvips-* packages that NFT walks
  // normally, so this glob is a no-op there.
  outputFileTracingIncludes: {
    "/*": ["node_modules/@img/sharp-*/**/*.dll"],
  },
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
