import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
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
 *    so we don't have to parse the "ready on http://..." log line.
 */
export async function startNextServer(standaloneDir: string): Promise<ServerHandle> {
  const port = await pickFreePort();

  const child = spawn(process.execPath, ["server.js"], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForReady(child, port);

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
  return new Promise<void>((resolve, reject) => {
    const READY_RE = new RegExp(`http://127\\.0\\.0\\.1:${port}\\b`);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Next.js server did not report ready within 30s"));
    }, 30_000);

    const onData = (buf: Buffer) => {
      if (READY_RE.test(buf.toString())) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Next.js server exited before ready (code ${code})`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}
