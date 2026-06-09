import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TemplateRuntime } from "../template-runtime.js";
import {
  patchConfigSource,
  readConfigSource,
  serializeConfigSource,
  validateConfig,
  type FieldError,
} from "./config-source.js";
import type { FileDiff } from "./diff.js";
import { hashContent } from "./paths.js";
import { assertEditablePath, writeTextFileAtomic } from "./text-files.js";

export interface TextEdit {
  path: string;
  content: string;
  baseHash: string;
}

export interface EditPayload {
  config: Record<string, unknown>;
  text: TextEdit[];
}

export interface PreviewResult {
  files: FileDiff[];
  validation: { ok: true } | { ok: false; errors: FieldError[] };
}

export type ApplyResult =
  | { ok: true; written: string[] }
  | { ok: false; errors: Array<{ path?: string; message: string }> };

function buildConfigDiff(
  workspaceRoot: string,
  configPath: string,
  patch: Record<string, unknown>
): FileDiff | null {
  if (Object.keys(patch).length === 0) {
    return null;
  }
  const source = readConfigSource(workspaceRoot, configPath);
  const before = serializeConfigSource(source.raw);
  const after = serializeConfigSource(patchConfigSource(source.raw, patch));
  return { path: configPath, kind: "config", before, after };
}

function buildTextDiffs(workspaceRoot: string, edits: TextEdit[]): FileDiff[] {
  return edits.map((edit) => {
    assertEditablePath(workspaceRoot, edit.path);
    const abs = resolve(workspaceRoot, edit.path);
    const before = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    return { path: edit.path, kind: "text" as const, before, after: edit.content };
  });
}

export function previewEdits(
  runtime: TemplateRuntime,
  workspaceRoot: string,
  configPath: string,
  payload: EditPayload
): PreviewResult {
  const files: FileDiff[] = [];
  const configDiff = buildConfigDiff(workspaceRoot, configPath, payload.config);
  if (configDiff) {
    files.push(configDiff);
  }
  files.push(...buildTextDiffs(workspaceRoot, payload.text));

  const source = readConfigSource(workspaceRoot, configPath);
  const validation = validateConfig(runtime, patchConfigSource(source.raw, payload.config));
  return { files, validation };
}

export function applyEdits(
  runtime: TemplateRuntime,
  workspaceRoot: string,
  configPath: string,
  payload: EditPayload
): ApplyResult {
  // Gate 1: config validation
  const source = readConfigSource(workspaceRoot, configPath);
  const patched = patchConfigSource(source.raw, payload.config);
  const validation = validateConfig(runtime, patched);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  // Gate 2: protected-zone guard
  try {
    if (Object.keys(payload.config).length > 0) {
      assertEditablePath(workspaceRoot, configPath);
    }
    for (const edit of payload.text) {
      assertEditablePath(workspaceRoot, edit.path);
    }
  } catch (error) {
    return {
      ok: false,
      errors: [{ message: error instanceof Error ? error.message : String(error) }],
    };
  }

  // Gate 3: optimistic concurrency for text files
  for (const edit of payload.text) {
    const abs = resolve(workspaceRoot, edit.path);
    const current = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    if (hashContent(current) !== edit.baseHash) {
      return {
        ok: false,
        errors: [{ path: edit.path, message: "File changed on disk; reload before applying." }],
      };
    }
  }

  // Gate 4: atomic writes
  const written: string[] = [];
  if (Object.keys(payload.config).length > 0) {
    writeTextFileAtomic(workspaceRoot, configPath, serializeConfigSource(patched));
    written.push(configPath);
  }
  for (const edit of payload.text) {
    writeTextFileAtomic(workspaceRoot, edit.path, edit.content);
    written.push(edit.path);
  }
  return { ok: true, written };
}
