#!/usr/bin/env node

/**
 * 深度研究报告生成器入口 —— 把多阶段 StatefulFlow 插进模板的 surface（acp/cli）。
 *
 * 这是模板里最复杂的示例（7 节点 / 3 轮 HITL / 双层 reflection / 并行调研），
 * 演示真实的长任务编排。
 *
 * 用法：
 *   tsx examples/deep-research/index.ts research "LangGraph 的架构与适用场景"   # CLI：确认主题→确认大纲→调研→审批
 *   tsx examples/deep-research/index.ts research -i                            # 交互模式
 *   tsx examples/deep-research/index.ts                                        # 启动 ACP 服务
 *
 * ACP 下：每次 interrupt 后 end_turn，你的下一条消息即被当作 resume。
 * 3 处 interrupt 的交互顺序：确认主题 → 确认大纲 → 审批终稿。
 */

import { config as loadDotenv } from "dotenv";
import { bootstrapFlowAcp } from "../../src/surfaces/acp/server.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";
import { loadFlowConfig } from "../../src/runtime/config.js";
import { createResearchFlow } from "./graph.js";

const argv = process.argv.slice(2);
const interactive = argv.includes("-i") || argv.includes("--interactive");
const debug = argv.includes("--debug");
const positional = argv.filter((a) => !a.startsWith("-"));
const isCli = positional[0] === "research";
const query = isCli ? positional.slice(1).join(" ") || undefined : undefined;

async function main(): Promise<void> {
  loadDotenv();
  const { appConfig } = loadFlowConfig();
  const flow = createResearchFlow(appConfig);

  if (isCli) {
    await runFlowCli(flow, {
      query,
      interactive,
      usage:
        '用法：\n  tsx examples/deep-research/index.ts research "LangGraph 的架构与适用场景"\n  tsx examples/deep-research/index.ts research -i\n',
    });
  } else {
    await bootstrapFlowAcp({ executor: flow, appConfig, debug });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
