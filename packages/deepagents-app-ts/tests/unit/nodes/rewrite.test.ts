/**
 * Rewrite 节点单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rewriteNode } from "../../../src/app/nodes/rewrite.js";

// Mock ChatAnthropic
vi.mock("@langchain/anthropic", () => {
  return {
    ChatAnthropic: vi.fn().mockImplementation(() => ({
      invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          rewritten_query: "重写后的查询",
          intent: "factual",
          keywords: ["关键词1", "关键词2"],
          mcp_hint: "chromadb",
        }),
      }),
    })),
  };
});

describe("rewriteNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return structured rewrite result", async () => {
    const state = {
      query: "什么是机器学习？",
      history: [],
    };

    const result = await rewriteNode(state);

    expect(result).toHaveProperty("rewritten_query");
    expect(result).toHaveProperty("intent");
    expect(result).toHaveProperty("keywords");
    expect(result.intent).toBe("factual");
  });

  it("should include history context", async () => {
    const mockMessages = [
      { _getType: () => "human", content: "你好" },
      { _getType: () => "ai", content: "你好！有什么可以帮助你的？" },
    ];

    const state = {
      query: "什么是机器学习？",
      history: mockMessages as any,
    };

    const result = await rewriteNode(state);
    expect(result).toBeDefined();
  });

  it("should fallback on error", async () => {
    // Mock error
    const { ChatAnthropic } = await import("@langchain/anthropic");
    vi.mocked(ChatAnthropic).mockImplementation(() => ({
      invoke: vi.fn().mockRejectedValue(new Error("API Error")),
    }) as any);

    const state = {
      query: "什么是机器学习？",
      history: [],
    };

    const result = await rewriteNode(state);

    // Should fallback to original query
    expect(result.rewritten_query).toBe("什么是机器学习？");
    expect(result.intent).toBe("factual");
  });
});
