/**
 * Filesystem Path Resolution Middleware
 *
 * Resolves workspace-relative paths (e.g. "/test.txt") to absolute paths
 * before filesystem tools execute. This is needed because:
 * - The LLM generates workspace-relative paths like "/test.txt"
 * - ACP clients (Zed) require absolute paths for fs/write_text_file
 */

import { createMiddleware } from "langchain";
import { resolve } from "node:path";

const FS_TOOLS = new Set(["write_file", "edit_file", "read_file"]);
const PATH_KEYS = ["file_path", "path"];

export function createFsPathResolver(workspaceRoot: string) {
  // Normalize workspace root for comparison (ensure trailing slash)
  const normalizedRoot = workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/";

  return createMiddleware({
    name: "fsPathResolver",

    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name;
      const originalArgs = request.toolCall.args;

      if (FS_TOOLS.has(toolName) && originalArgs) {
        const args = { ...originalArgs };
        for (const key of PATH_KEYS) {
          const val = args[key];
          if (typeof val === "string" && val.startsWith("/")) {
            // Only resolve if it's NOT already under workspace root
            // (i.e., it's a workspace-relative path like "/test.txt", not "/Users/.../test.txt")
            if (!val.startsWith(normalizedRoot) && val !== workspaceRoot) {
              args[key] = resolve(workspaceRoot, val.slice(1));
            }
          }
        }
        request.toolCall.args = args;
      }

      return handler(request);
    },
  });
}
