/**
 * examples 共用件 —— 把各示例重复的两段样板收成一处：
 *   1. LLM + 无凭证 fallback（getExampleModel）
 *   2. 工具调用三态透出（runTool）
 *
 * 故意放在 examples/（而非 src/）：示例之间共享，但不让 src 依赖示例、也不污染模板核心。
 * 各示例用相对路径 import：`import { getExampleModel, runTool } from "../shared.js";`
 */

import { randomUUID } from "node:crypto";
import { resolveModel, logger, type AppConfig } from "deepagents-app-ts/runtime";
import type { ToolCallEvent } from "../src/surfaces/flow-types.js";

const log = logger.child("example-shared");

/**
 * 有凭证 → 返回 chat model；无凭证（本地 / CI）→ 返回 null（调用方走启发式 fallback）。
 * 检查标准 env 变量 + appConfig 声明的 apiKeyEnv/authTokenEnv，与默认图的 llm helper 同口径。
 */
export function getExampleModel(appConfig?: AppConfig) {
  const vars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"];
  const model = appConfig?.model as
    | { apiKeyEnv?: string; authTokenEnv?: string }
    | undefined;
  if (model?.apiKeyEnv) vars.push(model.apiKeyEnv);
  if (model?.authTokenEnv) vars.push(model.authTokenEnv);

  if (!appConfig || !vars.some((v) => Boolean(process.env[v]))) {
    log.warn("无模型凭证 → 示例 LLM 节点走启发式 fallback");
    return null;
  }
  const resolved = resolveModel(appConfig);
  return resolved && typeof resolved !== "string" ? resolved : null;
}

/**
 * 执行一个工具，并把过程经 onToolCall 透出（in_progress → completed/failed）。
 * 消除每个工具节点重复的「生成 id → 发 in_progress → try/catch → 发 completed/failed」样板。
 *
 * @returns { result, ok } —— result 为工具输出（失败时为错误信息），ok 标记成败。
 */
export async function runTool(
  toolName: string,
  args: Record<string, unknown>,
  fn: () => string | Promise<string>,
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>
): Promise<{ result: string; ok: boolean }> {
  const toolCallId = randomUUID();
  if (onToolCall) {
    await onToolCall({ toolCallId, toolName, args, status: "in_progress" });
  }
  try {
    const result = await fn();
    if (onToolCall) {
      await onToolCall({ toolCallId, toolName, args, status: "completed", result });
    }
    return { result, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (onToolCall) {
      await onToolCall({ toolCallId, toolName, args, status: "failed", error: message });
    }
    return { result: message, ok: false };
  }
}
