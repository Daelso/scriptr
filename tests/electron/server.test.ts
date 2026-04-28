import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildChildEnv, startNextServer } from "@/electron/server";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("server — buildChildEnv", () => {
  // Cast through Record so we don't have to satisfy Next.js's ambient ProcessEnv
  // augmentation (which requires NODE_ENV). The function under test only reads
  // string values, never the type-system contract.
  const parent = {
    PATH: "/usr/bin",
    HOME: "/home/x",
    USERPROFILE: "C:\\Users\\X",
    APPDATA: "C:\\Users\\X\\AppData\\Roaming",
    XAI_API_KEY: "xai-secret",
    SCRIPTR_DATA_DIR: "/data",
    NODE_OPTIONS: "--max-old-space-size=4096",
    LANG: "en_US.UTF-8",
    // sensitive parent vars that must NOT propagate
    SSH_AUTH_SOCK: "/tmp/ssh-agent",
    GITHUB_TOKEN: "ghp_secret",
    NPM_TOKEN: "npm_secret",
    AWS_ACCESS_KEY_ID: "aws_secret",
    GPG_AGENT_INFO: "/tmp/gpg",
    OPENAI_API_KEY: "sk-secret",
    PORT: "9999", // parent's PORT must be overwritten
  };

  it("propagates only allowlisted variables", () => {
    const env = buildChildEnv(parent as unknown as NodeJS.ProcessEnv, 41234);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    expect(env.USERPROFILE).toBe("C:\\Users\\X");
    expect(env.APPDATA).toBe("C:\\Users\\X\\AppData\\Roaming");
    expect(env.XAI_API_KEY).toBe("xai-secret");
    expect(env.SCRIPTR_DATA_DIR).toBe("/data");
    expect(env.LANG).toBe("en_US.UTF-8");
  });

  it("blocks NODE_OPTIONS — pairs with the enableNodeOptionsEnvironmentVariable fuse to close the debugger-attach attack", () => {
    const env = buildChildEnv(parent as unknown as NodeJS.ProcessEnv, 41234);
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("propagates Windows-critical variables (SYSTEMROOT etc.) — Node crypto fails without these", () => {
    const winParent = {
      SYSTEMROOT: "C:\\Windows",
      WINDIR: "C:\\Windows",
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      PROGRAMDATA: "C:\\ProgramData",
      HOMEDRIVE: "C:",
      HOMEPATH: "\\Users\\X",
      OS: "Windows_NT",
      NUMBER_OF_PROCESSORS: "8",
    };
    const env = buildChildEnv(winParent as unknown as NodeJS.ProcessEnv, 1);
    expect(env.SYSTEMROOT).toBe("C:\\Windows");
    expect(env.WINDIR).toBe("C:\\Windows");
    expect(env.COMSPEC).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(env.PATHEXT).toBe(".COM;.EXE;.BAT;.CMD");
    expect(env.PROGRAMFILES).toBe("C:\\Program Files");
    expect(env["PROGRAMFILES(X86)"]).toBe("C:\\Program Files (x86)");
    expect(env.PROGRAMDATA).toBe("C:\\ProgramData");
    expect(env.HOMEDRIVE).toBe("C:");
    expect(env.HOMEPATH).toBe("\\Users\\X");
    expect(env.OS).toBe("Windows_NT");
    expect(env.NUMBER_OF_PROCESSORS).toBe("8");
  });

  it("blocks sensitive parent variables", () => {
    const env = buildChildEnv(parent as unknown as NodeJS.ProcessEnv, 41234);
    expect(env.SSH_AUTH_SOCK).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.GPG_AGENT_INFO).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("sets PORT, HOSTNAME, NODE_ENV from arguments (overriding parent PORT)", () => {
    const env = buildChildEnv(parent as unknown as NodeJS.ProcessEnv, 41234);
    expect(env.PORT).toBe("41234");
    expect(env.HOSTNAME).toBe("127.0.0.1");
    expect(env.NODE_ENV).toBe("production");
  });

  it("sets ELECTRON_RUN_AS_NODE=1 — without this the spawned Electron binary tries to load server.js as an app", () => {
    const env = buildChildEnv(parent as unknown as NodeJS.ProcessEnv, 41234);
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("does not include undefined parent values", () => {
    const env = buildChildEnv(
      { PATH: undefined, HOME: "/h" } as unknown as NodeJS.ProcessEnv,
      1,
    );
    expect(Object.keys(env)).not.toContain("PATH");
    expect(env.HOME).toBe("/h");
  });
});

describe("server — startNextServer onExit", () => {
  // Build a tiny standalone-shaped directory whose `server.js` listens on
  // PORT, then exits ~500ms later with a non-zero code after writing to
  // stderr. This exercises the full onExit code path without needing real Next.
  // 500ms (not 50ms) gives waitForReady's 100ms polling loop time to detect
  // the server before the child exits.
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-server-test-"));
    await writeFile(
      join(tmp, "server.js"),
      `
      const http = require("http");
      const port = parseInt(process.env.PORT, 10);
      const srv = http.createServer((_, res) => res.end("ok"));
      srv.listen(port, "127.0.0.1", () => {
        setTimeout(() => {
          process.stderr.write("simulated boom\\n");
          process.exit(7);
        }, 500);
      });
      `,
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("fires onExit with code, signal, and stderrTail after the child dies", async () => {
    const handle = await startNextServer(tmp);
    const info = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      stderrTail: string;
    }>((resolve) => {
      handle.onExit(resolve);
    });
    expect(info.code).toBe(7);
    expect(info.signal).toBeNull();
    expect(info.stderrTail).toContain("simulated boom");
  }, 10_000);

  it("re-registering onExit replaces the previous listener", async () => {
    const handle = await startNextServer(tmp);
    let firstCalled = false;
    handle.onExit(() => {
      firstCalled = true;
    });
    const second = new Promise<void>((resolve) => {
      handle.onExit(() => resolve());
    });
    await second;
    expect(firstCalled).toBe(false);
  }, 10_000);
});
