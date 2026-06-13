/**
 * 示例：旅行规划（travel planner）——【拓扑：并行 map-reduce + 之后 HITL 确认】
 *
 * 对应 LangGraph 官方 how-to：**Map-reduce（`Send` 动态扇出）** + **Human-in-the-loop**。
 * 需求场景：把一个目标拆成多个方面**并行**处理、聚合，再让用户确认/调整——
 * 旅行规划、多源调研、批量生成都属此类。
 *
 *   START → gather → ⟨Send 并行⟩ research × N(transport/stay/sights/food)
 *         → aggregate → confirm(interrupt 确认/调整) → finalize → END
 *
 * 看点：
 *  - **Send 扇出**：gather 后用条件边对每个 aspect 派一个 research 实例（并行跑）。
 *  - **reducer channel**：findings 用 reducer 聚合并行写（并行节点写同一 channel 必须用 reducer，否则互相覆盖）。
 *  - **onToolCall 并发**：research 并行调"检索"工具，经 `config.configurable.onToolCall` 透出（callbacks 随调用流动，不污染固定的图/checkpointer）。
 *  - **HITL**：并行聚合之后才 interrupt，复用模板 StatefulFlow seam。
 * ⚠️ 节点名不能与 state channel 同名。
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
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import type {
  StatefulFlow,
  FlowRunResult,
  FlowCallbacks,
} from "../../src/surfaces/flow-types.js";
import { runTool } from "../shared.js";

const log = logger.child("travel");

const ASPECTS = ["transport", "stay", "sights", "food"] as const;
const ASPECT_LABEL: Record<string, string> = {
  transport: "交通",
  stay: "住宿",
  sights: "景点",
  food: "美食",
};

interface Finding {
  aspect: string;
  suggestion: string;
}

const TravelState = Annotation.Root({
  query: Annotation<string>,
  destination: Annotation<string>,
  days: Annotation<number>,
  /** Send 给每个 research 实例的输入（每个实例独立，不会互串） */
  currentAspect: Annotation<string>,
  /** 并行写 → 必须用 reducer 聚合 */
  findings: Annotation<Finding[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  itinerary: Annotation<string>,
  feedback: Annotation<string>,
  output: Annotation<string>,
});
type TravelStateType = typeof TravelState.State;

/** demo 建议（无凭证可跑；真实场景换成检索 / LLM）。 */
function demoSuggestion(aspect: string, destination: string, days: number): string {
  const label = ASPECT_LABEL[aspect] ?? aspect;
  switch (aspect) {
    case "transport":
      return `${destination}${label}：建议地铁日票 + 步行；机场往返用快线。`;
    case "stay":
      return `${destination}${label}：${days} 晚，选市中心近地铁的酒店，均价适中。`;
    case "sights":
      return `${destination}${label}：Top 景点按区域分天，避免来回奔波。`;
    case "food":
      return `${destination}${label}：每天 1 家当地特色 + 1 家人气小吃。`;
    default:
      return `${destination}${label}：暂无建议。`;
  }
}

/** gather：解析目的地 + 天数（纯逻辑）。 */
function gatherNode(state: TravelStateType): Partial<TravelStateType> {
  const q = state.query.trim();
  const daysMatch = q.match(/(\d+)\s*(天|日|days?)/i);
  const days = daysMatch ? Math.max(1, parseInt(daysMatch[1]!, 10)) : 3;
  const rest = q.replace(/(\d+)\s*(天|日|days?)/gi, " ").trim();
  const destination = rest.split(/[\s,，]+/)[0] || "目的地";
  log.info("gather", { destination, days });
  return { destination, days, findings: [] };
}

/** 条件边：对每个 aspect 派一个 research 实例（map）。payload 显式带齐 research 所需字段。 */
function fanoutToResearch(state: TravelStateType): Send[] {
  return ASPECTS.map(
    (aspect) =>
      new Send("research", {
        currentAspect: aspect,
        destination: state.destination,
        days: state.days,
      })
  );
}

/** research：处理单个 aspect（并行实例之一），经 onToolCall 透出"检索"过程。 */
async function researchNode(
  state: TravelStateType,
  config?: LangGraphRunnableConfig
): Promise<Partial<TravelStateType>> {
  const onToolCall = config?.configurable?.onToolCall as
    | FlowCallbacks["onToolCall"]
    | undefined;
  const aspect = state.currentAspect;
  const { result } = await runTool(
    "search_travel",
    { aspect, destination: state.destination },
    () => demoSuggestion(aspect, state.destination, state.days),
    onToolCall
  );
  return { findings: [{ aspect, suggestion: result }] };
}

/** aggregate：等所有并行 research 完成后执行一次（LangGraph barrier），合成行程草案。 */
function aggregateNode(state: TravelStateType): Partial<TravelStateType> {
  // 并行完成顺序不定 → 按 ASPECTS 固定顺序重排，输出稳定
  const ordered = ASPECTS.map((a) =>
    state.findings.find((f) => f.aspect === a)
  ).filter((f): f is Finding => Boolean(f));
  const itinerary =
    `【${state.destination} ${state.days} 天行程草案】\n` +
    ordered
      .map((f) => `· ${ASPECT_LABEL[f.aspect] ?? f.aspect}：${f.suggestion}`)
      .join("\n");
  return { itinerary };
}

/** confirm：interrupt 暂停，把行程草案抛给用户确认/调整。 */
function confirmNode(state: TravelStateType): Partial<TravelStateType> {
  const feedback = interrupt({
    question: `${state.itinerary}\n\n以上行程 OK 吗？要调整（预算 / 天数 / 偏好）就说一下，或回复「ok」确认。`,
  });
  return { feedback: String(feedback ?? "").trim() };
}

/** finalize：按用户回复定稿。 */
function finalizeNode(state: TravelStateType): Partial<TravelStateType> {
  const fb = (state.feedback ?? "").toLowerCase();
  const approved =
    !fb || ["ok", "通过", "可以", "confirm", "yes", "好"].some((w) => fb.includes(w));
  const output = approved
    ? `✅ 行程已确认：\n${state.itinerary}`
    : `✏️ 已记录你的调整意见并据此微调：\n${state.itinerary}\n\n[调整] ${state.feedback}`;
  return { output };
}

export function createTravelGraph() {
  return new StateGraph(TravelState)
    .addNode("gather", gatherNode)
    .addNode("research", researchNode)
    .addNode("aggregate", aggregateNode)
    .addNode("confirm", confirmNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "gather")
    .addConditionalEdges("gather", fanoutToResearch, ["research"])
    .addEdge("research", "aggregate")
    .addEdge("aggregate", "confirm")
    .addEdge("confirm", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer: new MemorySaver() });
}

/**
 * 包装成模板 StatefulFlow：run({query}) 跑到 confirm 的 interrupt → {interrupted}；
 * run({resume}) 用同一 threadId 恢复 → finalize → {done}。
 * onToolCall 经 config.configurable 透传给并行的 research 实例。
 */
export function createTravelFlow(_appConfig?: AppConfig): StatefulFlow {
  const graph = createTravelGraph();
  return {
    async run(input, threadId, callbacks): Promise<FlowRunResult> {
      const config = {
        configurable: { thread_id: threadId, onToolCall: callbacks?.onToolCall },
      };
      const stream =
        input.resume !== undefined
          ? await graph.stream(new Command({ resume: input.resume }), config)
          : await graph.stream({ query: input.query ?? "" }, config);

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
      return { status: "done", answer: (snapshot.values as TravelStateType).output ?? "" };
    },
  };
}
