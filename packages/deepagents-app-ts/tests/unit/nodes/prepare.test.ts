/**
 * Prepare 节点单元测试
 */

import { describe, it, expect } from "vitest";
import { prepareNode } from "../../../src/app/nodes/prepare.js";
import { DEFAULT_RAG_CONFIG } from "../../../src/app/nodes/types.js";

describe("prepareNode", () => {
  it("should handle empty results", async () => {
    const state = {
      query: "test",
      raw_results: [],
    };

    const result = await prepareNode(state, DEFAULT_RAG_CONFIG);

    expect(result.context).toBe("");
    expect(result.sources).toEqual([]);
    expect(result.token_count).toBe(0);
  });

  it("should merge and deduplicate results", async () => {
    const state = {
      query: "test",
      raw_results: [
        {
          tool: "chromadb",
          content: "结果1：这是测试内容",
          metadata: {},
        },
        {
          tool: "brave-search",
          content: "结果1：这是测试内容",  // 重复
          metadata: {},
        },
        {
          tool: "chromadb",
          content: "结果2：这是不同的内容",
          metadata: {},
        },
      ],
    };

    const config = {
      ...DEFAULT_RAG_CONFIG,
      prepare: {
        ...DEFAULT_RAG_CONFIG.prepare,
        deduplication: true,
      },
    };

    const result = await prepareNode(state, config);

    // Should deduplicate
    expect(result.sources?.length).toBeLessThan(3);
    expect(result.context).toContain("结果1");
    expect(result.context).toContain("结果2");
  });

  it("should truncate to token limit", async () => {
    const longContent = "这是一段很长的内容。".repeat(1000);

    const state = {
      query: "test",
      raw_results: [
        {
          tool: "chromadb",
          content: longContent,
          metadata: {},
        },
      ],
    };

    const config = {
      ...DEFAULT_RAG_CONFIG,
      prepare: {
        ...DEFAULT_RAG_CONFIG.prepare,
        maxContextTokens: 100,
      },
    };

    const result = await prepareNode(state, config);

    // Should be truncated
    expect(result.token_count).toBeLessThanOrEqual(100);
  });

  it("should extract sources", async () => {
    const state = {
      query: "test",
      raw_results: [
        {
          tool: "chromadb",
          content: "测试内容",
          metadata: { source: "文档1" },
        },
      ],
    };

    const result = await prepareNode(state, DEFAULT_RAG_CONFIG);

    expect(result.sources).toBeDefined();
    expect(result.sources?.length).toBeGreaterThan(0);
  });
});
