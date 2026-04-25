import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer, connect as netConnect } from "node:net";
import { once } from "node:events";

export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

/**
 * Boot the Next.js server bundled into a standalone output directory.
 * `standaloneDir` is the directory containing `server.js` — i.e., what Next
 * emits at `<projectRoot>/.next/standalone/` after `next build`.
 *
 * Why spawn-as-child instead of in-process `next({ ... })`:
 *
 * 1. With `output: "standalone"`, Next pre-bakes a `nextConfig` blob into
 *    `.next/standalone/server.js` and exits its programmatic API. Calling
 *    `next({ ... })` from outside warns "next start does not work with
 *    output: standalone" and routes through code that expects to be the
 *    main entry — fragile under Electron.
 * 2. Spawning gives a clean process boundary. If the server crashes, we
 *    learn via `exit`. On Electron quit, we kill it.
 * 3. We pre-resolve a free TCP port ourselves and pass it via PORT env,
 *    then poll TCP connect to detect "ready" — no fragile log parsing.
 */
export async function startNextServer(standaloneDir: string): Promise<ServerHandle> {
  const port = await pickFreePort();

  // Minimal env passed to the child. Spreading parent process.env would leak
  // SSH_AUTH_SOCK, NPM_TOKEN, GITHUB_TOKEN, AWS_*, GPG_AGENT_INFO, etc. into
  // a network-talking process running OpenAI SDK code. We pass only what
  // Node, Next, and scriptr's own config layer need to function.
  const childEnv = buildChildEnv(process.env, port);

  const child: ChildProcess = spawn(process.execPath, ["server.js"], {
    cwd: standaloneDir,
    // Cast — buildChildEnv returns a plain Record because Next.js's ambient
    // ProcessEnv types make NODE_ENV a const-typed required field.
    env: childEnv as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Capture stderr so a failed startup gives a useful error message.
  let stderrBuf = "";
  child.stderr?.on("data", (b: Buffer) => {
    stderrBuf += b.toString();
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  await waitForReady(child, port).catch((err: Error) => {
    if (stderrBuf) err.message += `\n--- next stderr ---\n${stderrBuf.trim()}`;
    throw err;
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
}

// ─── Env allowlist ───────────────────────────────────────────────────────────

// What we let through into the spawned Next process. Anything not on this
// list is dropped — see buildChildEnv. The Windows entries are NOT optional:
// without SYSTEMROOT, Node's crypto module can't locate bcryptprimitives.dll
// and the process crashes on the first randomBytes() call (Next does this
// during startup). The CI release matrix builds artifacts but doesn't run
// them, so this had to be added by hand rather than caught by green CI.
const ENV_PASSTHROUGH = new Set([
  // POSIX:
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  // Windows (load-bearing for crypto + native modules + child spawn):
  "SYSTEMROOT", // bcryptprimitives.dll lives here — required for crypto
  "WINDIR", // some libs probe this instead of SYSTEMROOT
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "HOMEDRIVE",
  "HOMEPATH",
  "OS",
  "NUMBER_OF_PROCESSORS",
  // scriptr-specific:
  "XAI_API_KEY", // honored by lib/config.ts as an apiKey override
  "SCRIPTR_DATA_DIR",
  "SCRIPTR_UPDATES_CHECK",
  "SCRIPTR_DEFAULT_MODEL",
  // Node tuning:
  "NODE_OPTIONS",
]);

// Use a plain Record instead of NodeJS.ProcessEnv — Next.js's ambient types
// make NODE_ENV a const-typed required field, which doesn't fit "build me a
// fresh env from scratch."
export function buildChildEnv(parent: NodeJS.ProcessEnv, port: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) {
    if (v !== undefined && ENV_PASSTHROUGH.has(k)) out[k] = v;
  }
  out.PORT = String(port);
  out.HOSTNAME = "127.0.0.1";
  out.NODE_ENV = "production";
  return out;
}

// ─── Port + readiness ────────────────────────────────────────────────────────

async function pickFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (!addr || typeof addr === "string") {
        probe.close();
        reject(new Error("Could not pick a free port"));
        return;
      }
      const port = addr.port;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForReady(child: ChildProcess, port: number): Promise<void> {
  // Poll TCP connect until the server accepts. Doesn't depend on any specific
  // log format — version-proof against Next.js startup-message changes.
  const deadline = Date.now() + 30_000;
  let earlyExit: Error | null = null;
  const onEarlyExit = (code: number | null) => {
    earlyExit = new Error(`Next.js server exited before ready (code ${code})`);
  };
  child.once("exit", onEarlyExit);

  try {
    while (Date.now() < deadline) {
      if (earlyExit) throw earlyExit;
      if (await canConnect(port, 250)) return;
      await delay(100);
    }
    throw new Error("Next.js server did not accept connections within 30s");
  } finally {
    // Detach the early-exit listener once the wait resolves either way —
    // future graceful shutdowns shouldn't run this closure (it'd set
    // earlyExit on a now-out-of-scope variable, harmless but wasteful).
    child.off("exit", onEarlyExit);
  }
}

function canConnect(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const sock = netConnect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
