import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beginHarnessToolCall,
  beginHarnessTurn,
  completeHarnessToolCall,
  completeHarnessTurn,
  failHarnessTurn,
  readHarnessLifecycle,
  recordHarnessModelCall,
} from "../../src/runtime/harness-lifecycle.js";
import { getRuntimeStorage } from "../../src/runtime/runtime-storage.js";

describe("harness-lifecycle", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "harness-lifecycle-test-"));
    workspaceRoot = join(tmpDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    process.env.DEEPAGENTS_HOME = join(tmpDir, "home");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tracks turn, model call, tool call, pending write, and completion", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_harness" });

    beginHarnessTurn("hello", storage);
    recordHarnessModelCall(storage);
    const pending = beginHarnessToolCall("write_file", { file_path: "/tmp/a.txt" }, storage);

    expect(readHarnessLifecycle(storage)).toMatchObject({
      phase: "tool_call",
      busy: true,
      counters: {
        turns: 1,
        modelCalls: 1,
        toolCalls: 1,
        failedTurns: 0,
      },
      pendingWrites: [expect.objectContaining({ path: "/tmp/a.txt" })],
    });

    completeHarnessToolCall(pending.id, storage);
    completeHarnessTurn(storage);

    expect(readHarnessLifecycle(storage)).toMatchObject({
      phase: "idle",
      busy: false,
      pendingWrites: [],
      currentTurn: expect.objectContaining({
        inputPreview: "hello",
        modelCalls: 1,
        toolCalls: 1,
      }),
    });
  });

  it("marks failed turns and clears pending writes", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_failed" });

    beginHarnessTurn("explode", storage);
    beginHarnessToolCall("edit_file", { file_path: "/tmp/b.txt" }, storage);
    failHarnessTurn(new Error("boom"), storage);

    expect(readHarnessLifecycle(storage)).toMatchObject({
      phase: "failed",
      busy: false,
      pendingWrites: [],
      lastError: "boom",
      counters: expect.objectContaining({ failedTurns: 1 }),
    });
  });
});

