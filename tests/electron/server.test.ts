import { describe, it, expect } from "vitest";
import { buildChildEnv } from "@/electron/server";

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
    SCRIPTR_UPDATES_CHECK: "1",
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
    expect(env.SCRIPTR_UPDATES_CHECK).toBe("1");
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=4096");
    expect(env.LANG).toBe("en_US.UTF-8");
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

  it("does not include undefined parent values", () => {
    const env = buildChildEnv(
      { PATH: undefined, HOME: "/h" } as unknown as NodeJS.ProcessEnv,
      1,
    );
    expect(Object.keys(env)).not.toContain("PATH");
    expect(env.HOME).toBe("/h");
  });
});
