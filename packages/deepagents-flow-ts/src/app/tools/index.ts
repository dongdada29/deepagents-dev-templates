/**
 * Flow 工具集组装 —— 选择性复用 app-ts 通用工具 + flow 自补工具 + native MCP 工具。
 *
 * flow-ts 不全盘继承 app-ts coding-agent 工具（schedule_action/agent_memory/
 * conversation_history/checkpoint 等）——只挑跨场景通用的，叠加 flow 自管的
 * bash/fs/search/demo/mcp-bridge，再合并 MCPManager 加载的 native MCP 工具。
 */

import type { StructuredTool } from "@langchain/core/tools";
import type { RuntimeContext } from "deepagents-app-ts/runtime";
import { createBashTool } from "./bash.tool.js";
import { createFsTools } from "./fs.tool.js";
import { createSearchTools } from "./search.tool.js";
import { createDemoTools } from "./demo.tool.js";
import { createMcpBridgeTool } from "./mcp-bridge.tool.js";
import type { FlowSandboxPolicy } from "../../runtime/sandbox.js";

/** 从 app-ts 全套工具里挑跨场景通用的（排除 coding-agent 专用）。 */
const REUSE_FROM_APP = new Set([
  "http_request",
  "json_utils",
  "platform_api",
  "agent_variable",
  "runtime_info",
]);

export function createFlowTools(
  ctx: RuntimeContext,
  opts: { workspaceRoot: string; policy: FlowSandboxPolicy }
): StructuredTool[] {
  const reused = ctx.tools.filter((t) => REUSE_FROM_APP.has(t.name));
  const flowBuiltin: StructuredTool[] = [
    createBashTool(opts),
    ...createFsTools(opts),
    ...createSearchTools(opts),
    ...createDemoTools(),
    createMcpBridgeTool(ctx.mcpManager),
  ];
  return [...reused, ...flowBuiltin, ...ctx.mcpTools];
}
