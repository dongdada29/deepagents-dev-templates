import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSlashCommand } from "../../src/runtime/slash-commands.js";
import { appendRuntimeMessage, getRuntimeStorage } from "../../src/runtime/runtime-storage.js";

describe("slash-commands", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "slash-commands-test-"));
    workspaceRoot = join(tmpDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    process.env.DEEPAGENTS_HOME = join(tmpDir, "home");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renders a specified durable session with recent messages", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_target" });
    appendRuntimeMessage({ role: "user", content: "hello from target" }, storage);

    const result = executeSlashCommand("/session sess_target", {
      environment: "cli",
      tools: [],
      config: {
        agent: { name: "test-agent" },
        model: { provider: "openai", name: "test-model" },
        platform: {},
        skills: { directories: [] },
      },
      workspaceRoot,
      sessionId: "sess_current",
    });

    expect(result?.kind).toBe("handled");
    expect(result?.text).toContain("指定会话:");
    expect(result?.text).toContain("Session:     sess_target");
    expect(result?.text).toContain("Messages:    1");
    expect(result?.text).toContain("hello from target");
  });
});
