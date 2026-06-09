/**
 * Protected Paths Middleware
 *
 * Denies write_file / edit_file tool calls whose target path matches a deny
 * rule. This is a workaround for deepagents-acp's `DeepAgentsServer` dropping
 * the `permissions` field when calling `createDeepAgent` — see
 * deepagents-acp/dist/index.js around line 1285 (the `createDeepAgent({...})`
 * call has no `permissions` key). Without this middleware, the deny rules
 * defined in `config.permissions.deniedPaths` would be silently ignored.
 *
 * Why a custom middleware rather than injecting another
 * `createFilesystemMiddleware` from deepagents? Because deepagents always
 * appends its own FilesystemMiddleware internally; a second one would
 * register duplicate `write_file` / `edit_file` tool names and confuse the
 * tool dispatcher.
 *
 * Path matching mirrors `buildPermissions()`: deny entries are workspace-
 * relative; we resolve them to absolute globs and test against the absolute
 * file_path the tool receives.
 */

import { createMiddleware, ToolMessage } from "langchain";
import { join } from "node:path";
import { logger } from "../logger.js";

export interface ProtectedPathsOptions {
  /** Absolute globs (starting with `/`) for paths to deny. */
  deniedGlobs: string[];
  /** Names of tool calls to guard. Defaults to file-writing tools. */
  toolNames?: string[];
}

const DEFAULT_GUARDED_TOOLS = ["write_file", "edit_file"];

/**
 * Tiny glob matcher supporting the only two metacharacters we emit:
 *   `**` — any number of path segments
 *   `*`  — any characters within a single segment
 *
 * Avoids the `micromatch` dependency (no @types/micromatch in this project)
 * and keeps the matcher deterministic for our deny patterns. The deny
 * globs are always produced by `buildPermissions()` and end in `/**`, so
 * this minimal coverage is sufficient.
 */
function globMatch(path: string, pattern: string): boolean {
  // Escape regex metachars, then reintroduce the wildcards we support.
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\0")               // temp placeholder for **
        .replace(/\*/g, "[^/]*")              // * within one segment
        .replace(/\0/g, ".*") +               // ** -> any depth
      "$"
  );
  return re.test(path);
}

export function createProtectedPathsMiddleware(options: ProtectedPathsOptions) {
  const { deniedGlobs, toolNames = DEFAULT_GUARDED_TOOLS } = options;
  const log = logger.child("protected-paths");
  const guarded = new Set(toolNames);

  if (deniedGlobs.length === 0) {
    // No-op middleware — still register so the agent has a stable middleware
    // count, and so swap-in/swap-out tests can find it.
    return createMiddleware({
      name: "protected-paths",
      wrapToolCall: async (request, handler) => handler(request),
    });
  }

  return createMiddleware({
    name: "protected-paths",

    wrapToolCall: async (request, handler) => {
      if (!guarded.has(request.toolCall.name)) {
        return handler(request);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filePath = (request.toolCall.args as any)?.file_path as string | undefined;
      if (!filePath) {
        return handler(request);
      }

      // Normalize: relative paths become absolute against the workspace root
      // that the agent believes it's working in. deepagents passes OS-absolute
      // paths to these tools, so the absolute form is the common case.
      const absolute = filePath.startsWith("/") ? filePath : join(process.cwd(), filePath);

      for (const pattern of deniedGlobs) {
        if (globMatch(absolute, pattern)) {
          log.warn("Denied tool call to protected path", {
            tool: request.toolCall.name,
            path: filePath,
            pattern,
          });
          // Return a ToolMessage error instead of throwing. Throwing a raw
          // Error from wrapToolCall gets wrapped by deepagents-acp as an
          // Internal error and propagated to the ACP client as a fatal
          // session-prompt failure, which kills the test runner. Returning
          // a ToolMessage surfaces the error to the agent (so it can
          // acknowledge and stop trying) without breaking the session.
          return new ToolMessage({
            content: `Error: permission denied for ${request.toolCall.name} on ${filePath} (matches protected pattern ${pattern})`,
            tool_call_id: request.toolCall.id ?? "",
            name: request.toolCall.name,
            status: "error",
          });
        }
      }

      return handler(request);
    },
  });
}
