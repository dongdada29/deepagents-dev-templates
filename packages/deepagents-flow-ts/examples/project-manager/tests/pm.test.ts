/**
 * 项目管理 flow 测试 —— 守住评估循环（条件边重规划）+ HITL 审批闭环。
 * 全程无凭证（节点纯逻辑），结果确定。
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createPMFlow,
  routeAfterEvaluate,
  MAX_REPLAN,
  type PMStateType,
} from "../graph.js";

describe("routeAfterEvaluate (条件边)", () => {
  const s = (o: Partial<PMStateType>): PMStateType => ({
    goal: "x",
    tasks: [],
    decision: "",
    attempts: 0,
    feedback: "",
    output: "",
    ...o,
  });
  it("incomplete & 未达上限 → plan(重规划)", () => {
    expect(routeAfterEvaluate(s({ decision: "incomplete", attempts: 1 }))).toBe("plan");
  });
  it("incomplete & 达上限 → approve(防死循环)", () => {
    expect(
      routeAfterEvaluate(s({ decision: "incomplete", attempts: MAX_REPLAN }))
    ).toBe("approve");
  });
  it("complete → approve", () => {
    expect(routeAfterEvaluate(s({ decision: "complete", attempts: 1 }))).toBe("approve");
  });
});

describe("project-manager flow (评估循环 + HITL)", () => {
  it("首轮任务不足 → 重规划补全 → interrupt 出完整计划", async () => {
    const flow = createPMFlow();
    const res = await flow.run({ query: "做一个落地页" }, randomUUID());
    expect(res.status).toBe("interrupted");
    if (res.status === "interrupted") {
      expect(res.question).toContain("项目计划");
      // 重规划后补到 4 个任务
      expect(res.question).toContain("开发实现");
      expect(res.question).toContain("测试上线");
    }
  });

  it("resume 'ok' → 批准 + 甘特排期", async () => {
    const flow = createPMFlow();
    const tid = randomUUID();
    await flow.run({ query: "做一个落地页" }, tid);
    const done = await flow.run({ resume: "ok" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") {
      expect(done.answer).toContain("已批准");
      expect(done.answer).toContain("排期");
    }
  });

  it("resume 给意见 → 记录调整", async () => {
    const flow = createPMFlow();
    const tid = randomUUID();
    await flow.run({ query: "做一个落地页" }, tid);
    const done = await flow.run({ resume: "加一个上线评审环节" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") expect(done.answer).toContain("已按意见调整");
  });
});
