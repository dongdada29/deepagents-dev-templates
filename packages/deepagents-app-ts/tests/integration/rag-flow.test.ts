/**
 * RAG 流程集成测试
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { createRAGGraph, executeRAG } from "../../src/app/graph.js";
import { DEFAULT_RAG_CONFIG } from "../../src/app/nodes/types.js";

// Mock 所有 LLM 调用
vi.mock("@langchain/anthropic", () => {
  return {
    ChatAnthropic: vi.fn().mockImplementation(() => ({
      invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          rewritten_query: "机器学习的定义和应用",
          intent: "factual",
          keywords: ["机器学习", "人工智能"],
          mcp_hint: "chromadb",
        }),
      }),
      stream: vi.fn().mockImplementation(async function* () {
        yield { content: "机器学习是" };
        yield { content: "人工智能的一个分支" };
        yield { content: "，它使计算机能够从数据中学习。" };
      }),
    })),
  };
});

describe("RAG Flow Integration", () => {
  it("should create a valid graph", () => {
    const graph = createRAGGraph(DEFAULT_RAG_CONFIG);
    expect(graph).toBeDefined();
  });

  it("should execute full RAG flow", async () => {
    const result = await executeRAG("什么是机器学习？", {
      config: DEFAULT_RAG_CONFIG,
    });

    expect(result).toHaveProperty("answer");
    expect(result).toHaveProperty("sources");
    expect(result).toHaveProperty("metadata");
    expect(result.metadata).toHaveProperty("duration_ms");
    expect(result.metadata).toHaveProperty("tools_used");
  });

  it("should handle empty MCP tools gracefully", async () => {
    const config = {
      ...DEFAULT_RAG_CONFIG,
      retrievalTools: [],
    };

    const result = await executeRAG("测试", { config });

    expect(result.answer).toBeDefined();
    expect(result.sources).toEqual([]);
  });

  it("should include metadata in response", async () => {
    const result = await executeRAG("测试问题");

    expect(result.metadata).toBeDefined();
    expect(result.metadata.duration_ms).toBeGreaterThan(0);
    expect(Array.isArray(result.metadata.tools_used)).toBe(true);
  });

  it("should calculate confidence score", async () => {
    const result = await executeRAG("什么是机器学习？");

    expect(result.confidence).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
