/**
 * Retrieve 节点 - MCP 工具调度
 *
 * 职责：
 * 1. 根据意图 + mcp_hint 决策调用哪些 MCP 工具
 * 2. 并行调用多个工具
 * 3. 收集原始结果
 */

import type { RAGState, RetrievalResult, RAGConfig } from "./types.js";

export async function retrieveNode(
  state: RAGState,
  config: RAGConfig
): Promise<Partial<RAGState>> {
  const { rewritten_query, intent, mcp_hint } = state;
  const query = rewritten_query || state.query;

  if (!config.retrievalTools || config.retrievalTools.length === 0) {
    console.warn("[Retrieve] No retrieval tools configured");
    return { raw_results: [] };
  }

  try {
    // 根据意图和 mcp_hint 选择工具
    const toolsToUse = selectTools(config.retrievalTools, intent, mcp_hint);

    console.log(
      `[Retrieve] Using tools: ${toolsToUse.join(", ")} for intent: ${intent}`
    );

    // 并行调用工具
    const results = await Promise.allSettled(
      toolsToUse.map((tool) => callMCPTool(tool, query, config))
    );

    // 收集成功的结果
    const raw_results: RetrievalResult[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        raw_results.push(result.value);
      } else if (result.status === "rejected") {
        console.error(
          `[Retrieve] Tool ${toolsToUse[index]} failed:`,
          result.reason
        );
      }
    });

    return { raw_results };
  } catch (error) {
    console.error("[Retrieve] Error:", error);
    return { raw_results: [] };
  }
}

/**
 * 根据意图选择工具
 */
function selectTools(
  availableTools: string[],
  intent?: string,
  mcpHint?: string
): string[] {
  // 如果有明确的 hint，优先使用
  if (mcpHint && availableTools.includes(mcpHint)) {
    return [mcpHint];
  }

  // 根据意图选择工具
  const intentToolMap: Record<string, string[]> = {
    latest: ["brave-search", "tavily", "serper"], // 最新信息用搜索
    factual: ["chromadb", "qdrant", "milvus"],     // 事实查询用向量库
    how_to: ["chromadb", "brave-search"],           // 操作指南用知识库+搜索
    comparison: ["chromadb", "brave-search"],       // 对比用多个源
    explain: ["chromadb"],                          // 解释用知识库
  };

  const preferredTools = intentToolMap[intent || "factual"] || [];
  const selected = preferredTools.filter((t) => availableTools.includes(t));

  // 如果没有匹配的，使用所有可用工具
  return selected.length > 0 ? selected : availableTools.slice(0, 3);
}

/**
 * 调用 MCP 工具
 * 这里需要与实际的 MCP 工具系统集成
 */
async function callMCPTool(
  toolName: string,
  query: string,
  _config: RAGConfig
): Promise<RetrievalResult> {
  // TODO: 实际实现需要调用 MCP 工具
  // 这里是占位实现，实际应该通过 MCP manager 调用
  console.log(`[Retrieve] Calling MCP tool: ${toolName} with query: ${query}`);

  // 模拟工具调用
  // 实际实现应该：
  // 1. 从 MCP manager 获取工具实例
  // 2. 调用工具的 invoke 方法
  // 3. 解析返回结果

  return {
    tool: toolName,
    content: `[Placeholder] Results from ${toolName} for: ${query}`,
    metadata: {
      tool: toolName,
      query,
      timestamp: new Date().toISOString(),
    },
  };
}
