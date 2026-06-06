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

  // ─── Turn transition primitives (G7 regression) ───────────────────────
  // These isolate the begin → complete / begin → fail paths so the
  // middleware's beforeAgent / afterAgent / wrapModelCall-error wiring can be
  // verified through unit-level primitives. Before this split, only the
  // combined "tracks turn, model call, tool call, ..." test covered these
  // transitions, so the missing harness turn tracking bug (counters.turns
  // stayed at 0) wasn't caught by the existing suite.

  it("beginHarnessTurn transitions idle → running and increments turns", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_begin" });

    expect(readHarnessLifecycle(storage)).toMatchObject({
      phase: "idle",
      busy: false,
      counters: { turns: 0 },
    });
    expect(readHarnessLifecycle(storage).currentTurn).toBeUndefined();

    beginHarnessTurn("hi", storage);

    const snap = readHarnessLifecycle(storage);
    expect(snap.phase).toBe("running");
    expect(snap.busy).toBe(true);
    expect(snap.counters.turns).toBe(1);
    expect(snap.currentTurn).toMatchObject({
      index: 1,
      inputPreview: "hi",
      modelCalls: 0,
      toolCalls: 0,
    });
    expect(snap.currentTurn!.id).toBeDefined();
    expect(snap.currentTurn!.startedAt).toBeDefined();
  });

  it("completeHarnessTurn transitions running → idle and freezes counters", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_complete" });

    beginHarnessTurn("first", storage);
    recordHarnessModelCall(storage);
    const turnsAfterBegin = readHarnessLifecycle(storage).counters.turns;

    completeHarnessTurn(storage);

    const snap = readHarnessLifecycle(storage);
    expect(snap.phase).toBe("idle");
    expect(snap.busy).toBe(false);
    // turns is a monotonically increasing counter — does NOT decrement.
    expect(snap.counters.turns).toBe(turnsAfterBegin);
    // modelCalls counter persists (it's a session-wide counter).
    expect(snap.counters.modelCalls).toBe(1);
    // currentTurn retains its snapshot with endedAt set.
    expect(snap.currentTurn).toMatchObject({
      index: 1,
      inputPreview: "first",
      modelCalls: 1,
      toolCalls: 0,
    });
    expect(snap.currentTurn!.endedAt).toBeDefined();
  });

  it("failHarnessTurn transitions running → failed and records lastError", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_fail_only" });

    beginHarnessTurn("dying", storage);
    failHarnessTurn(new Error("kaboom"), storage);

    const snap = readHarnessLifecycle(storage);
    expect(snap.phase).toBe("failed");
    expect(snap.busy).toBe(false);
    expect(snap.counters.failedTurns).toBe(1);
    expect(snap.lastError).toBe("kaboom");
    // currentTurn retains its snapshot with endedAt set.
    expect(snap.currentTurn).toMatchObject({
      index: 1,
      inputPreview: "dying",
    });
    expect(snap.currentTurn!.endedAt).toBeDefined();
  });
});

