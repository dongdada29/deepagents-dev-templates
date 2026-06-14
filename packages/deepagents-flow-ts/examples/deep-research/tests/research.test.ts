/**
 * 深度研究报告 flow 测试。
 *  - 纯函数（无凭证、确定性）：routeAfterOutlineReview / routeAfterQualityReview / fanoutToResearch
 *    —— 守住双层 reflection 条件边 + MAX_* 封顶（防死循环）+ Send 扇出拓扑。
 *  - 真实接入（skipIf 无凭证）：plan / research / draft / outline_review / quality_review / finalize
 *    真调 LLM + context7 MCP，验证完整的多阶段 + 多轮 HITL 闭环。
 */

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createResearchFlow,
  routeAfterOutlineReview,
  routeAfterQualityReview,
  fanoutToResearch,
  MAX_OUTLINE_REVIEW,
  MAX_DRAFT_REVIEW,
  type ResearchStateType,
} from "../graph.js";
import { loadFlowConfig } from "../../../src/runtime/config.js";

const hasCreds = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"].some(
  (k) => Boolean(process.env[k])
);
const runIntegration = process.env.RUN_INTEGRATION === "1" && hasCreds;

// 构造测试 state 的辅助
function makeState(over: Partial<ResearchStateType>): ResearchStateType {
  return {
    topic: "test",
    refinedTopic: "test",
    outline: [{ title: "S1", query: "q1" }],
    currentSection: { title: "S1", query: "q1" },
    findings: [],
    outlineDecision: "",
    outlineCritique: "",
    outlineAttempts: 0,
    draftDecision: "",
    draftCritique: "",
    draftAttempts: 0,
    draft: "",
    finalReport: "",
    feedback: "",
    ...over,
  } as ResearchStateType;
}

describe("routeAfterOutlineReview (条件边, 纯函数, 无凭证)", () => {
  it("insufficient 且未达上限 → 回 plan 重规划", () => {
    const state = makeState({
      outlineDecision: "insufficient",
      outlineAttempts: 1,
    });
    expect(routeAfterOutlineReview(state)).toBe("plan");
  });

  it("insufficient 但已达 MAX_OUTLINE_REVIEW → 强制进 draft（防死循环）", () => {
    const state = makeState({
      outlineDecision: "insufficient",
      outlineAttempts: MAX_OUTLINE_REVIEW,
    });
    expect(routeAfterOutlineReview(state)).toBe("write_draft");
  });

  it("sufficient → 直接进 draft", () => {
    const state = makeState({
      outlineDecision: "sufficient",
      outlineAttempts: 1,
    });
    expect(routeAfterOutlineReview(state)).toBe("write_draft");
  });
});

describe("routeAfterQualityReview (条件边, 纯函数, 无凭证)", () => {
  it("fail 且未达上限 → 回 draft 重写", () => {
    const state = makeState({
      draftDecision: "fail",
      draftAttempts: 1,
    });
    expect(routeAfterQualityReview(state)).toBe("write_draft");
  });

  it("fail 但已达 MAX_DRAFT_REVIEW → 强制进 approve（防死循环）", () => {
    const state = makeState({
      draftDecision: "fail",
      draftAttempts: MAX_DRAFT_REVIEW,
    });
    expect(routeAfterQualityReview(state)).toBe("approve");
  });

  it("pass → 直接进 approve", () => {
    const state = makeState({
      draftDecision: "pass",
      draftAttempts: 1,
    });
    expect(routeAfterQualityReview(state)).toBe("approve");
  });
});

describe("fanoutToResearch (Send 扇出, 纯函数, 无凭证)", () => {
  it("为每个 outline section 派一个 Send 实例", () => {
    const state = makeState({
      outline: [
        { title: "架构", query: "langgraph architecture" },
        { title: "场景", query: "langgraph use cases" },
        { title: "对比", query: "langgraph vs crewai" },
      ],
    });
    const sends = fanoutToResearch(state);
    expect(sends.length).toBe(3);
  });

  it("空大纲 → 零 Send", () => {
    const state = makeState({ outline: [] });
    const sends = fanoutToResearch(state);
    expect(sends.length).toBe(0);
  });
});

describe.skipIf(!runIntegration)(
  "deep-research flow (真实 LLM + MCP, 多阶段 + 多轮 HITL)",
  () => {
    const { appConfig } = loadFlowConfig();

    it(
      "首轮跑到 outline_gate interrupt：返回大纲确认问题",
      async () => {
        const flow = createResearchFlow(appConfig);
        const res = await flow.run(
          { query: "LangGraph 的架构与适用场景" },
          randomUUID()
        );
        expect(res.status).toBe("interrupted");
        if (res.status === "interrupted")
          expect(res.question).toContain("大纲");
      },
      120000
    );

    it(
      "完整 3 轮 HITL：confirm → outline → approve → done",
      async () => {
        const flow = createResearchFlow(appConfig);
        const tid = randomUUID();

        // interrupt①: 确认主题
        const r1 = await flow.run(
          { query: "TypeScript 在后端开发中的优势与挑战" },
          tid
        );
        expect(r1.status).toBe("interrupted");

        // resume① → interrupt②: 确认大纲
        const r2 = await flow.run({ resume: "ok" }, tid);
        expect(r2.status).toBe("interrupted");
        if (r2.status === "interrupted") expect(r2.question).toContain("大纲");

        // resume② → 并行调研 + 初稿 + 质量评审 → interrupt③: 审批终稿
        const r3 = await flow.run({ resume: "ok" }, tid);
        expect(r3.status).toBe("interrupted");
        if (r3.status === "interrupted") expect(r3.question).toContain("终稿");

        // resume③: 批准 → finalize → done
        const r4 = await flow.run({ resume: "ok" }, tid);
        expect(r4.status).toBe("done");
      },
      300000
    );
  }
);
