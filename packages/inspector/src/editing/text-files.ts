import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { hashContent } from "./paths.js";

export const EDITABLE_ZONES = ["config", "prompts", "skills", ".agents"];

export function assertEditablePath(workspaceRoot: string, relPath: string): void {
  if (isAbsolute(relPath)) {
    throw new Error(`Refusing absolute path: ${relPath}`);
  }
  const abs = resolve(workspaceRoot, relPath);
  const rel = relative(workspaceRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  const top = rel.split(/[/\\]/)[0]!;
  if (!EDITABLE_ZONES.includes(top)) {
    throw new Error(`Path is outside an editable zone (${EDITABLE_ZONES.join(", ")}): ${relPath}`);
  }
}

export interface ReadFile {
  content: string;
  hash: string;
}

export function readTextFile(workspaceRoot: string, relPath: string): ReadFile | null {
  assertEditablePath(workspaceRoot, relPath);
  const abs = resolve(workspaceRoot, relPath);
  if (!existsSync(abs)) {
    return null;
  }
  const content = readFileSync(abs, "utf-8");
  return { content, hash: hashContent(content) };
}

export function writeTextFileAtomic(workspaceRoot: string, relPath: string, content: string): void {
  assertEditablePath(workspaceRoot, relPath);
  const abs = resolve(workspaceRoot, relPath);
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, abs);
}
