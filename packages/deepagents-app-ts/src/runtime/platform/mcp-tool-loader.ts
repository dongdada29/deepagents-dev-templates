/**
 * MCP Tool Loader
 *
 * Uses `@langchain/mcp-adapters` `MultiServerMCPClient` to connect to MCP
 * servers and register their tools as native LangChain `StructuredTool`
 * instances. These are merged with the builtin tools and passed to
 * `createDeepAgent(tools=[...builtin, ...mcp])` so the agent calls MCP
 * tools directly by name — no bridge indirection needed.
 *
 * Replaces the previous `mcp_tool_bridge` tool that used a hand-rolled
 * stdio JSON-RPC implementation (~200 lines). The `MCPManager` is still
 * used for config management (3-tier merge); this module handles the
 * runtime tool loading.
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { StructuredTool } from "@langchain/core/tools";
import type { MCPManager } from "./mcp-manager.js";
import { logger } from "../logger.js";

const log = logger.child("mcp-tool-loader");

/**
 * Convert MCPManager server configs to MultiServerMCPClient format.
 * Adds a `transport` field if missing (inferred from `command` vs `url`).
 * Returns the `Record<string, Connection>` shorthand format accepted by
 * the constructor.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toClientFormat(servers: Record<string, any>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    const entry = { ...cfg };
    if (!entry.transport) {
      if (entry.url) {
        entry.transport = "http";
      } else if (entry.command) {
        entry.transport = "stdio";
      } else {
        log.warn("Cannot determine transport for MCP server, skipping", { name });
        continue;
      }
    }
    out[name] = entry;
  }
  return out;
}

/**
 * Load native LangChain tools from all configured MCP servers.
 *
 * Returns an empty array if no servers are configured or all connections
 * fail (degrades gracefully — the agent continues with builtin tools only).
 */
export async function loadMcpTools(mcpManager: MCPManager): Promise<StructuredTool[]> {
  const config = mcpManager.getMergedConfig();
  const serverNames = Object.keys(config.servers);

  if (serverNames.length === 0) {
    return [];
  }

  const clientConfig = toClientFormat(config.servers);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new MultiServerMCPClient(clientConfig as any);
    const tools = await client.getTools();
    log.info("Loaded MCP tools", {
      servers: serverNames,
      tools: tools.length,
    });
    return tools;
  } catch (err) {
    log.warn("Failed to load MCP tools, continuing without them", {
      servers: serverNames,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
