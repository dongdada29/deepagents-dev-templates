/**
 * 深度研究报告生成器 ——【长任务示例：多阶段流水线 + 多轮 HITL + 双层 reflection + 并行调研】
 *
 * 这是模板里最复杂的示例，演示现有 examples 从不覆盖的"长任务编排"维度：
 *  - 多阶段流水线：选题确认 → 大纲规划 → 并行调研 → 初稿生成 → 质量评审 → 定稿
 *  - 多轮 HITL：3 处 interrupt（确认主题、确认大纲、审批终稿）
 *  - 双层 reflection 循环：大纲评审重试 + 初稿质量评审重试
 *  - Send 并行扇出：每章节独立调研（MCP 搜索 + LLM 整理）
 *  - 复杂状态管理：大纲/章节/调研结果/初稿/终稿跨阶段累积
 *
 *   START → clarify ─(interrupt①: 确认主题)→ plan ─(interrupt②: 确认大纲)→
 *         ⟨Send 并行⟩ research × N → outline_review ─(条件边)─┐
 *                                          ▲                    ├─ 不达标 & 未达上限 → plan(带意见重规划)
 *                                          └────────────────────┘
 *                                                     └─ 达标 → draft → quality_review ─(条件边)─┐
 *                                                                      ▲                        ├─ 不达标 & 未达上限 → draft(带意见重写)
 *                                                                      └────────────────────────┘
 *                                                                            └─ 达标 → approve ─(interrupt③: 审批终稿)→ finalize → END
 *
 * 对应 LangGraph 官方模式组合：
 *   多轮 HITL + Send map-reduce + Reflection/evaluator-optimizer + 条件边循环
 *
 * 真实接入（无 demo fallback——未配凭证直接报错）：
 *  - plan / research / draft / outline_review / quality_review / finalize **真调大模型**
 *  - research 调 context7 MCP（文档检索）做真实资料搜集
 *  - onToolCall 透出每次搜索；HITL 用 interrupt 暂停。
 *
 * ⚠️ 节点名不能与 state channel 同名（LangGraph 限制）。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  Send,
  MemorySaver,
  interrupt,
  Command,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import type {
  StatefulFlow,
  FlowRunResult,
  FlowCallbacks,
} from "../../src/surfaces/flow-types.js";
import { requireModel, extractText, runTool, isApproval } from "../shared.js";
import { callMcpTool, rateLimited, type McpServerConfig } from "../mcp-client.js";

const log = logger.child("deep-research");

// ── 常量 ────────────────────────────────────────────────

/** 大纲评审重试上限（防 reflection 死循环）。 */
export const MAX_OUTLINE_REVIEW = 2;
/** 初稿质量评审重试上限。 */
export const MAX_DRAFT_REVIEW = 2;
/** 单次 research 节点的 MCP 搜索超时。 */
const SEARCH_TIMEOUT_MS = 20000;

/** 文档检索 MCP（context7，免 key）。 */
const SEARCH_MCP: McpServerConfig = {
  command: "npx",
  args: ["-y", "@upstash/context7-mcp"],
};

// ── 类型 ────────────────────────────────────────────────

interface OutlineSection {
  title: string;
  query: string;
}

interface ResearchFinding {
  title: string;
  searchResult: string;
  summary: string;
}

// ── State ───────────────────────────────────────────────

const ResearchState = Annotation.Root({
  topic: Annotation<string>,
  refinedTopic: Annotation<string>,
  outline: Annotation<OutlineSection[]>,
  currentSection: Annotation<OutlineSection>,
  findings: Annotation<ResearchFinding[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  outlineDecision: Annotation<string>,
  outlineCritique: Annotation<string>,
  outlineAttempts: Annotation<number>,
  draftDecision: Annotation<string>,
  draftCritique: Annotation<string>,
  draftAttempts: Annotation<number>,
  draft: Annotation<string>,
  finalReport: Annotation<string>,
  feedback: Annotation<string>,
});
export type ResearchStateType = typeof ResearchState.State;

// ── 工具函数 ────────────────────────────────────────────

/**
 * 从 LLM 文本里抽出第一段 JSON（容忍 ```json 围栏与前后说明文字）。
 */
function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error(`LLM 未返回 JSON：${text.slice(0, 200)}`);
  const close = cleaned[start] === "[" ? "]" : "}";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) throw new Error(`LLM JSON 不完整：${text.slice(0, 200)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

// ── 节点 ────────────────────────────────────────────────

/**
 * clarify：interrupt① — 与用户确认/调整研究主题。
 * 把原始 topic 抛给用户，等回复后写入 refinedTopic。
 */
function clarifyNode(state: ResearchStateType): Partial<ResearchStateType> {
  const feedback = interrupt({
    question:
      `🔬 研究主题：「${state.topic}」\n\n` +
      `确认研究这个主题，或提供更具体的方向（如：聚焦某个技术栈、某个场景、某个对比维度）。\n` +
      `直接回复「ok」确认，或输入你的调整。`,
  });
  const fb = String(feedback ?? "").trim();
  return {
    refinedTopic: fb && !isApproval(fb) ? `${state.topic}（方向：${fb}）` : state.topic,
  };
}

/**
 * plan：LLM 生成研究大纲（3-5 个章节，每章节含标题+检索关键词）。
 * 重规划轮把上一轮大纲评审意见喂回去改进。
 */
async function planNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const isReplan = state.outlineAttempts > 0 && Boolean(state.outlineCritique);
  const res = await model.invoke([
    new SystemMessage(
      `你是资深研究分析师。为给定主题制定一份研究报告大纲，包含 3-5 个章节（Section）。` +
        `每章节含 title（标题）和 query（用于文档检索的关键词，英文优先）。` +
        `只输出 JSON 数组：[{"title":"...","query":"..."}]，不要解释。` +
        (isReplan ? `\n上一轮评审意见（据此改进大纲）：${state.outlineCritique}` : "")
    ),
    new HumanMessage(`研究主题：${state.refinedTopic}`),
  ]);
  const sections = parseJson<OutlineSection[]>(extractText(res.content));
  log.info("plan", {
    sections: sections.length,
    attempt: state.outlineAttempts + 1,
    isReplan,
  });
  return {
    outline: sections,
    findings: [],
    outlineAttempts: state.outlineAttempts + 1,
  };
}

/**
 * outlineGate：interrupt② — 把大纲抛给用户确认。
 */
function outlineGateNode(state: ResearchStateType): Partial<ResearchStateType> {
  const list = state.outline
    .map((s, i) => `${i + 1}. ${s.title}（搜索：${s.query}）`)
    .join("\n");
  const feedback = interrupt({
    question:
      `📋 研究大纲（${state.refinedTopic}）：\n${list}\n\n` +
      `确认大纲开始调研，或回复调整意见。\n直接回复「ok」确认。`,
  });
  const fb = String(feedback ?? "").trim();
  if (fb && !isApproval(fb)) {
    return {
      outlineCritique: fb,
      outlineDecision: "user_revise",
    };
  }
  return { outlineDecision: "ok" };
}

/**
 * fanoutToResearch：条件边函数 — 为每个 outline section 派一个 research 实例（Send 扇出）。
 * 导出供单测。
 */
export function fanoutToResearch(state: ResearchStateType): Send[] {
  return state.outline.map(
    (section) =>
      new Send("research", {
        currentSection: section,
        refinedTopic: state.refinedTopic,
      })
  );
}

/**
 * research：对单个 section 发一次 context7 文档检索（rateLimited 节流），
 * 然后 LLM 把搜索结果整理成结构化摘要。
 */
async function researchNode(
  state: ResearchStateType,
  config?: LangGraphRunnableConfig
): Promise<Partial<ResearchStateType>> {
  const onToolCall = config?.configurable?.onToolCall as
    | FlowCallbacks["onToolCall"]
    | undefined;
  const section = state.currentSection;
  const query = section.query;

  const { result: searchResult, ok } = await runTool(
    "context7_search",
    { query },
    () =>
      rateLimited(
        () => callMcpTool(SEARCH_MCP, "search", { query }, SEARCH_TIMEOUT_MS),
        1500
      ),
    onToolCall
  );

  const rawMaterial = ok
    ? searchResult.slice(0, 1200)
    : `（搜索失败：${searchResult}，将基于主题常识整理）`;

  const model = requireModel(
    config?.configurable?.appConfig as AppConfig,
    "deep-research 示例"
  );
  const res = await model.invoke([
    new SystemMessage(
      `你是技术分析师。根据检索资料，为章节「${section.title}」写一段 200-400 字的结构化摘要。` +
        `提取关键事实、数据、结论，不要堆砌链接。只输出摘要正文。`
    ),
    new HumanMessage(
      `主题：${state.refinedTopic}\n章节：${section.title}\n检索关键词：${query}\n检索资料：\n${rawMaterial}`
    ),
  ]);
  const summary = extractText(res.content).trim();
  log.info("research done", { section: section.title, summaryLen: summary.length });
  return {
    findings: [{ title: section.title, searchResult: rawMaterial, summary }],
  };
}

/**
 * outline_review：LLM 评审并行调研结果的质量。
 * 判断是否充分覆盖了大纲，不充分则带评审意见回 plan 重规划。
 */
async function outlineReviewNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const findingsSummary = state.findings
    .map((f) => `## ${f.title}\n${f.summary.slice(0, 200)}...`)
    .join("\n\n");
  const res = await model.invoke([
    new SystemMessage(
      `你是研究评审。判断调研结果是否充分覆盖了大纲的所有章节、每章是否有实质内容。` +
        `只输出 JSON：{"verdict":"sufficient"|"insufficient","critique":"一句话说明缺什么，或为何可通过"}。`
    ),
    new HumanMessage(
      `主题：${state.refinedTopic}\n大纲章节：${state.outline.map((s) => s.title).join("、")}\n\n调研摘要：\n${findingsSummary}`
    ),
  ]);
  const v = parseJson<{ verdict?: string; critique?: string }>(extractText(res.content));
  const decision = v.verdict === "insufficient" ? "insufficient" : "sufficient";
  log.info("outline_review", { decision, findings: state.findings.length });
  return { outlineDecision: decision, outlineCritique: v.critique ?? "" };
}

/**
 * 条件边（纯函数）：大纲评审不达标 & 未达上限 → 回 plan；否则 → draft。
 * 导出供单测。
 */
export function routeAfterOutlineReview(state: ResearchStateType): "plan" | "write_draft" {
  if (
    state.outlineDecision === "insufficient" &&
    state.outlineAttempts < MAX_OUTLINE_REVIEW
  ) {
    return "plan";
  }
  return "write_draft";
}

/**
 * draft：LLM 基于全部调研结果生成报告初稿。
 * 重写轮把质量评审意见喂回去改进。
 */
async function draftNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const isRewrite = state.draftAttempts > 0 && Boolean(state.draftCritique);
  const material = state.findings
    .map((f) => `## ${f.title}\n${f.summary}`)
    .join("\n\n---\n\n");
  const res = await model.invoke([
    new SystemMessage(
      `你是资深技术写作专家。根据调研资料，为「${state.refinedTopic}」撰写一份结构清晰、逻辑连贯的研究报告。` +
        `报告应包含引言、各章节分析、结论与建议。Markdown 格式，800-2000 字。不要堆砌链接，聚焦洞察。` +
        (isRewrite ? `\n质量评审意见（据此改进）：${state.draftCritique}` : "")
    ),
    new HumanMessage(`调研资料：\n${material}`),
  ]);
  const draft = extractText(res.content).trim();
  log.info("draft", { length: draft.length, attempt: state.draftAttempts + 1, isRewrite });
  return { draft, draftAttempts: state.draftAttempts + 1 };
}

/**
 * quality_review：LLM 评审报告质量。
 * 不达标则带意见回 draft 重写。
 */
async function qualityReviewNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const res = await model.invoke([
    new SystemMessage(
      `你是报告质量评审。判断报告是否：结构完整、论据充分、逻辑连贯、无明显遗漏。` +
        `只输出 JSON：{"verdict":"pass"|"fail","critique":"一句话说明问题，或为何通过"}。`
    ),
    new HumanMessage(
      `主题：${state.refinedTopic}\n报告（前 2000 字）：\n${state.draft.slice(0, 2000)}`
    ),
  ]);
  const v = parseJson<{ verdict?: string; critique?: string }>(extractText(res.content));
  const decision = v.verdict === "fail" ? "fail" : "pass";
  log.info("quality_review", { decision, attempt: state.draftAttempts });
  return { draftDecision: decision, draftCritique: v.critique ?? "" };
}

/**
 * 条件边（纯函数）：质量评审不达标 & 未达上限 → 回 draft；否则 → approve。
 * 导出供单测。
 */
export function routeAfterQualityReview(state: ResearchStateType): "write_draft" | "approve" {
  if (
    state.draftDecision === "fail" &&
    state.draftAttempts < MAX_DRAFT_REVIEW
  ) {
    return "write_draft";
  }
  return "approve";
}

/**
 * approve：interrupt③ — 把终稿抛给用户审批。
 */
function approveNode(state: ResearchStateType): Partial<ResearchStateType> {
  const feedback = interrupt({
    question:
      `📄 研究报告终稿（${state.refinedTopic}）：\n\n${state.draft}\n\n---\n` +
      `审阅终稿：直接说修改意见，或回复「ok」通过定稿。`,
  });
  return { feedback: String(feedback ?? "").trim() };
}

/**
 * finalize：通过则定稿；否则 LLM 按意见修订。
 */
async function finalizeNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const fb = (state.feedback ?? "").trim();
  if (isApproval(fb)) {
    return { finalReport: state.draft };
  }
  const model = requireModel(appConfig, "deep-research 示例");
  const res = await model.invoke([
    new SystemMessage("根据用户的修改意见修订报告终稿，只输出修订后的完整报告，不要解释。"),
    new HumanMessage(`原报告：\n${state.draft}\n\n修改意见：${fb}`),
  ]);
  return { finalReport: extractText(res.content).trim() };
}

// ── 图组装 ──────────────────────────────────────────────

export function createResearchGraph(appConfig?: AppConfig) {
  return new StateGraph(ResearchState)
    .addNode("clarify", clarifyNode)
    .addNode("plan", (s: ResearchStateType) => planNode(s, appConfig))
    .addNode("outline_gate", outlineGateNode)
    .addNode("research", (s: ResearchStateType, c?: LangGraphRunnableConfig) =>
      researchNode(s, c)
    )
    .addNode("outline_review", (s: ResearchStateType) => outlineReviewNode(s, appConfig))
    .addNode("write_draft", (s: ResearchStateType) => draftNode(s, appConfig))
    .addNode("quality_review", (s: ResearchStateType) => qualityReviewNode(s, appConfig))
    .addNode("approve", approveNode)
    .addNode("finalize", (s: ResearchStateType) => finalizeNode(s, appConfig))
    .addEdge(START, "clarify")
    .addEdge("clarify", "plan")
    .addEdge("plan", "outline_gate")
    .addConditionalEdges("outline_gate", (state: ResearchStateType) => {
      // 用户要改大纲 → 回 plan；确认 → 并行 research 扇出
      if (state.outlineDecision === "user_revise") return "plan";
      return fanoutToResearch(state);
    })
    .addEdge("research", "outline_review")
    .addConditionalEdges("outline_review", routeAfterOutlineReview, {
      plan: "plan",
      draft: "write_draft",
    })
    .addEdge("write_draft", "quality_review")
    .addConditionalEdges("quality_review", routeAfterQualityReview, {
      draft: "write_draft",
      approve: "approve",
    })
    .addEdge("approve", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer: new MemorySaver() });
}

// ── StatefulFlow 包装 ───────────────────────────────────

/**
 * 多轮 HITL 的 StatefulFlow 封装。
 *
 * 与 travel/pm 的单轮 HITL 不同，本示例有 3 处 interrupt（clarify / outline_gate / approve）。
 * 每次 run 到 interrupt 就返回问题，用户回复后 resume 继续跑到下一个 interrupt 或结束。
 */
export function createResearchFlow(appConfig?: AppConfig): StatefulFlow {
  const graph = createResearchGraph(appConfig);
  return {
    async run(input, threadId, callbacks): Promise<FlowRunResult> {
      const config = {
        configurable: {
          thread_id: threadId,
          onToolCall: callbacks?.onToolCall,
          appConfig,
        },
      };
      const stream =
        input.resume !== undefined
          ? await graph.stream(new Command({ resume: input.resume }), config)
          : await graph.stream(
              { topic: input.query ?? "", outlineAttempts: 0, draftAttempts: 0 },
              config
            );

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
        log.info("interrupted → 等待用户");
        return { status: "interrupted", question: q };
      }
      const snapshot = await graph.getState(config);
      const values = snapshot.values as ResearchStateType;
      return { status: "done", answer: values.finalReport ?? values.draft ?? "" };
    },
  };
}
