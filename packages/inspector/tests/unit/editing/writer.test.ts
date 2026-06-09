import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTemplateRuntime } from "../../../src/template-runtime.js";
import { previewEdits, applyEdits } from "../../../src/editing/writer.js";
import { hashContent } from "../../../src/editing/paths.js";

let root: string;
const CFG = "config/app-agent.config.json";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inspector-writer-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, CFG), JSON.stringify({ model: { name: "claude-x" } }, null, 2), "utf-8");
  writeFileSync(join(root, "prompts/sys.md"), "hello", "utf-8");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("writer", () => {
  it("preview returns per-file before/after without writing", async () => {
    const runtime = await loadTemplateRuntime();
    const preview = previewEdits(runtime, root, CFG, {
      config: { "model.name": "gpt-4o" },
      text: [{ path: "prompts/sys.md", content: "world", baseHash: hashContent("hello") }],
    });
    expect(preview.validation.ok).toBe(true);
    const cfgDiff = preview.files.find((f) => f.path === CFG)!;
    expect(cfgDiff.after).toContain("gpt-4o");
    expect(readFileSync(join(root, "prompts/sys.md"), "utf-8")).toBe("hello"); // not written
  });

  it("apply writes files and re-validates", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, {
      config: { "model.name": "gpt-4o" },
      text: [{ path: "prompts/sys.md", content: "world", baseHash: hashContent("hello") }],
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).model.name).toBe("gpt-4o");
    expect(readFileSync(join(root, "prompts/sys.md"), "utf-8")).toBe("world");
  });

  it("rejects invalid config (gate 1) and writes nothing", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, { config: { "permissions.mode": "nope" }, text: [] });
    expect(result.ok).toBe(false);
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).model.name).toBe("claude-x");
  });

  it("rejects a protected target path (gate 2)", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, {
      config: {},
      text: [{ path: "src/runtime/x.ts", content: "x", baseHash: hashContent("") }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a stale baseHash (gate 3) and writes nothing", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, {
      config: {},
      text: [{ path: "prompts/sys.md", content: "world", baseHash: "stale" }],
    });
    expect(result.ok).toBe(false);
    expect(readFileSync(join(root, "prompts/sys.md"), "utf-8")).toBe("hello");
  });
});
