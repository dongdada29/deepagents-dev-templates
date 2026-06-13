/**
 * 旅行规划 flow 测试 —— 守住 map-reduce（Send 并行 + reducer 聚合）+ onToolCall 并发 + HITL 闭环。
 * 全程无凭证（节点用 demo 数据），结果确定。
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createTravelFlow } from "../graph.js";
import type { ToolCallEvent } from "../../../src/surfaces/flow-types.js";

describe("travel-planner flow (map-reduce + HITL)", () => {
  it("并行 research 4 个 aspect → 聚合 → interrupt 出行程草案", async () => {
    const flow = createTravelFlow();
    const events: ToolCallEvent[] = [];
    const res = await flow.run({ query: "东京 3 天 美食优先" }, randomUUID(), {
      onToolCall: (e) => {
        events.push(e);
      },
    });

    expect(res.status).toBe("interrupted");
    if (res.status === "interrupted") {
      expect(res.question).toContain("行程草案");
      // 4 个 aspect 都并行聚合进草案
      for (const label of ["交通", "住宿", "景点", "美食"]) {
        expect(res.question).toContain(label);
      }
    }
    // onToolCall 并发：4 个工具各 in_progress + completed
    expect(events.filter((e) => e.status === "in_progress")).toHaveLength(4);
    expect(events.filter((e) => e.status === "completed")).toHaveLength(4);
  });

  it("resume 'ok' → 确认定稿（同一 threadId 续接草稿）", async () => {
    const flow = createTravelFlow();
    const tid = randomUUID();
    const first = await flow.run({ query: "巴黎 5 天" }, tid);
    expect(first.status).toBe("interrupted");
    const done = await flow.run({ resume: "ok" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") {
      expect(done.answer).toContain("已确认");
      expect(done.answer).toContain("巴黎");
    }
  });

  it("resume 给调整意见 → 记录调整", async () => {
    const flow = createTravelFlow();
    const tid = randomUUID();
    await flow.run({ query: "京都 2 天" }, tid);
    const done = await flow.run({ resume: "预算紧一点" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") {
      expect(done.answer).toContain("调整");
      expect(done.answer).toContain("预算紧一点");
    }
  });
});
