/**
 * 示例：项目管理（project manager）——【拓扑：分解 → 执行 → 评估循环 + HITL 审批】
 *
 * 对应 LangGraph 官方：**Reflection / evaluator-optimizer**（评估不达标就重做）+ **Branching**（条件边）+ **HITL**。
 * 需求场景：把目标拆成任务、估时排期、评估计划是否完备（不完备就重规划），最后人工审批。
 *
 *   START → plan → estimate → evaluate ─(条件边)─ 不完备 & 未达上限 → plan(重规划)
 *                                      └ 否则 → approve(interrupt 审批) → finalize → END
 *
 * 看点：
 *  - **评估循环（reflection）**：evaluate 判完备性，不达标用条件边回 plan 重做，`MAX_REPLAN` 封顶防死循环。
 *  - **HITL 审批**：计划成形后 interrupt 等人批准/调整，复用模板 StatefulFlow seam。
 * ⚠️ 节点名不能与 channel 同名：channel 有 decision，所以评估节点叫 evaluate。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  MemorySaver,
  interrupt,
  Command,
} from "@langchain/langgraph";
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import type { StatefulFlow, FlowRunResult } from "../../src/surfaces/flow-types.js";

const log = logger.child("pm");

/** 重规划次数上限（防评估循环死循环）。 */
export const MAX_REPLAN = 2;
const MIN_TASKS = 3;

interface Task {
  name: string;
  days?: number;
}

const PMState = Annotation.Root({
  goal: Annotation<string>,
  tasks: Annotation<Task[]>,
  decision: Annotation<string>,
  attempts: Annotation<number>,
  feedback: Annotation<string>,
  output: Annotation<string>,
});
export type PMStateType = typeof PMState.State;

const DAYS: Record<string, number> = {
  需求分析: 2,
  方案设计: 3,
  开发实现: 5,
  测试上线: 2,
};

/** plan：把目标拆成任务。demo 故意首轮拆少、重规划补全（演示评估循环）。 */
function planNode(state: PMStateType): Partial<PMStateType> {
  const attempts = state.attempts ?? 0;
  const base = ["需求分析", "方案设计"];
  const more = ["开发实现", "测试上线"];
  const names = attempts === 0 ? base : [...base, ...more];
  log.info("plan", { attempts, taskCount: names.length });
  return { tasks: names.map((name) => ({ name })) };
}

/** estimate：给每个任务估时（"执行"步骤的 demo）。 */
function estimateNode(state: PMStateType): Partial<PMStateType> {
  return { tasks: state.tasks.map((t) => ({ ...t, days: DAYS[t.name] ?? 3 })) };
}

/** evaluate：评估计划完备性（启发式：任务数 ≥ 阈值）。写 decision + 累加 attempts。 */
function evaluateNode(state: PMStateType): Partial<PMStateType> {
  const attempts = (state.attempts ?? 0) + 1;
  const decision = state.tasks.length >= MIN_TASKS ? "complete" : "incomplete";
  log.info("evaluate", { decision, tasks: state.tasks.length, attempts });
  return { decision, attempts };
}

/** 条件边：不完备且未达重规划上限 → 回 plan；否则 → approve。 */
export function routeAfterEvaluate(state: PMStateType): "plan" | "approve" {
  if (state.decision === "incomplete" && (state.attempts ?? 0) < MAX_REPLAN) {
    return "plan";
  }
  return "approve";
}

/** approve：interrupt 暂停，把计划抛给用户审批。 */
function approveNode(state: PMStateType): Partial<PMStateType> {
  const plan = state.tasks
    .map((t, i) => `${i + 1}. ${t.name}（${t.days ?? "?"} 天）`)
    .join("\n");
  const feedback = interrupt({
    question: `📋 项目计划（${state.goal}）：\n${plan}\n\n批准请回复「ok」，或提调整意见。`,
  });
  return { feedback: String(feedback ?? "").trim() };
}

/** finalize：按审批定稿，输出任务表 + 简单甘特（累计排期）。 */
function finalizeNode(state: PMStateType): Partial<PMStateType> {
  const fb = (state.feedback ?? "").toLowerCase();
  const approved =
    !fb || ["ok", "批准", "通过", "approve", "yes", "可以"].some((w) => fb.includes(w));
  let cursor = 0;
  const gantt = state.tasks
    .map((t) => {
      const start = cursor;
      const dur = t.days ?? 3;
      cursor += dur;
      return `  ${t.name}：D${start + 1}–D${cursor}（${dur} 天）`;
    })
    .join("\n");
  const header = approved
    ? `✅ 计划已批准（${state.goal}）`
    : `✏️ 已按意见调整（${state.goal}）：${state.feedback}`;
  return { output: `${header}\n排期（共 ${cursor} 天）：\n${gantt}` };
}

export function createPMGraph() {
  return new StateGraph(PMState)
    .addNode("plan", planNode)
    .addNode("estimate", estimateNode)
    .addNode("evaluate", evaluateNode)
    .addNode("approve", approveNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "plan")
    .addEdge("plan", "estimate")
    .addEdge("estimate", "evaluate")
    .addConditionalEdges("evaluate", routeAfterEvaluate, {
      plan: "plan",
      approve: "approve",
    })
    .addEdge("approve", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer: new MemorySaver() });
}

/** 包装成模板 StatefulFlow：run({query})→评估循环跑到 approve 的 interrupt；run({resume})→finalize。 */
export function createPMFlow(_appConfig?: AppConfig): StatefulFlow {
  const graph = createPMGraph();
  return {
    async run(input, threadId): Promise<FlowRunResult> {
      const config = { configurable: { thread_id: threadId } };
      const stream =
        input.resume !== undefined
          ? await graph.stream(new Command({ resume: input.resume }), config)
          : await graph.stream({ goal: input.query ?? "" }, config);

      let interruptValue: unknown;
      for await (const chunk of stream) {
        const intr = (chunk as Record<string, unknown>).__interrupt__ as
          | Array<{ value?: unknown }>
          | undefined;
        if (intr && intr.length) interruptValue = intr[0]?.value;
      }

      if (interruptValue !== undefined) {
        const q =
          (interruptValue as { question?: string })?.question ??
          String(interruptValue);
        return { status: "interrupted", question: q };
      }
      const snapshot = await graph.getState(config);
      return { status: "done", answer: (snapshot.values as PMStateType).output ?? "" };
    },
  };
}
