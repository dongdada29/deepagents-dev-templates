import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertEditablePath, readTextFile, writeTextFileAtomic } from "../../../src/editing/text-files.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inspector-edit-"));
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, "prompts/sys.md"), "hello", "utf-8");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("text-files", () => {
  it("allows paths inside editable zones", () => {
    expect(() => assertEditablePath(root, "prompts/sys.md")).not.toThrow();
    expect(() => assertEditablePath(root, "config/app-agent.config.json")).not.toThrow();
  });

  it("rejects protected and escaping paths", () => {
    expect(() => assertEditablePath(root, "src/runtime/x.ts")).toThrow();
    expect(() => assertEditablePath(root, "../outside.md")).toThrow();
    expect(() => assertEditablePath(root, "/etc/passwd")).toThrow();
  });

  it("reads with a content hash and round-trips an atomic write", () => {
    const read = readTextFile(root, "prompts/sys.md");
    expect(read?.content).toBe("hello");
    writeTextFileAtomic(root, "prompts/sys.md", "world");
    expect(readTextFile(root, "prompts/sys.md")?.content).toBe("world");
  });
});
