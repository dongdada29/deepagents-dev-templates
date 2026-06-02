/**
 * Stuck Loop Detection Middleware
 *
 * Detects when the agent gets stuck in repetitive tool call patterns:
 * (a) Repeated identical tool calls (same name + same args)
 * (b) A-B-A-B alternating patterns
 * (c) No-op calls returning the same result
 *
 * Inspired by pydantic-deepagents' StuckLoopDetection capability.
 */

import { createMiddleware, ToolMessage } from "langchain";

export interface StuckLoopOptions {
  /** Number of repeated calls before triggering. Default: 3 */
  threshold?: number;
  /** Whether to warn (retry) or error (stop). Default: "warn" */
  mode?: "warn" | "error";
}

interface CallRecord {
  name: string;
  argsHash: string;
  resultHash: string;
}

function hashString(s: string): string {
  // Simple fast hash for comparison (not cryptographic)
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function detectPatterns(history: CallRecord[], threshold: number): string | null {
  if (history.length < threshold) return null;

  const recent = history.slice(-threshold);

  // Pattern (a): All identical calls (same name + same args)
  const allSameCall = recent.every(
    (c) => c.name === recent[0]!.name && c.argsHash === recent[0]!.argsHash
  );
  if (allSameCall) {
    return `Stuck in loop: "${recent[0]!.name}" called ${threshold} times with identical arguments`;
  }

  // Pattern (b): A-B-A-B alternating
  if (threshold >= 4 && recent.length >= 4) {
    const isAlternating = recent.every((c, i) => {
      const expected = recent[i % 2]!;
      return c.name === expected.name && c.argsHash === expected.argsHash;
    });
    if (isAlternating && recent[0]!.name !== recent[1]!.name) {
      return `Stuck in alternating loop: "${recent[0]!.name}" ↔ "${recent[1]!.name}" repeated ${threshold / 2} times`;
    }
  }

  // Pattern (c): Same call with same result (no-op)
  if (recent.length >= threshold) {
    const allSameResult = recent.every(
      (c) =>
        c.name === recent[0]!.name &&
        c.argsHash === recent[0]!.argsHash &&
        c.resultHash === recent[0]!.resultHash &&
        c.resultHash !== ""
    );
    if (allSameResult) {
      return `Stuck in no-op loop: "${recent[0]!.name}" returns identical result ${threshold} times`;
    }
  }

  return null;
}

/**
 * Create a stuck-loop detection middleware.
 *
 * Tracks recent tool calls and detects repetitive patterns.
 * When a loop is detected, returns a ToolMessage instructing the agent
 * to try a different approach.
 */
export function createStuckLoopMiddleware(options: StuckLoopOptions = {}) {
  const threshold = options.threshold ?? 3;
  const mode = options.mode ?? "warn";

  // Per-session history (reset on each agent invocation)
  let callHistory: CallRecord[] = [];

  return createMiddleware({
    name: "stuckLoopDetection",

    beforeAgent: async () => {
      // Reset history at the start of each agent run
      callHistory = [];
    },

    wrapToolCall: async (request, handler) => {
      const name = request.toolCall.name;
      const argsHash = hashString(JSON.stringify(request.toolCall.args));

      // Execute the tool normally
      const result = await handler(request);

      // Extract result content for hashing
      let resultContent = "";
      if (result instanceof ToolMessage) {
        resultContent = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
      }

      const resultHash = hashString(resultContent);
      callHistory.push({ name, argsHash, resultHash });

      // Check for loops
      const loopMsg = detectPatterns(callHistory, threshold);
      if (loopMsg) {
        if (mode === "error") {
          throw new Error(loopMsg);
        }
        // warn mode: replace the tool result with a retry instruction
        return new ToolMessage({
          content: `⚠️ LOOP DETECTED: ${loopMsg}\n\nYou MUST try a completely different approach. Do NOT repeat the same tool call with the same arguments. Analyze why the previous attempts failed and change your strategy.`,
          tool_call_id: request.toolCall.id ?? "unknown",
          name,
        });
      }

      return result;
    },
  });
}
