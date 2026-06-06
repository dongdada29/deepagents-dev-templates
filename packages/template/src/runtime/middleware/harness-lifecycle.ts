import { createMiddleware } from "langchain";
import {
  beginHarnessToolCall,
  beginHarnessTurn,
  completeHarnessToolCall,
  completeHarnessTurn,
  failHarnessTurn,
  recordHarnessModelCall,
} from "../harness-lifecycle.js";

/**
 * Per-agent-turn tracking middleware.
 *
 * Hooks:
 *   - `beforeAgent`     → `beginHarnessTurn`     (counters.turns++, phase=running)
 *   - `afterAgent`      → `completeHarnessTurn`  (phase=idle, clears pendingWrites)
 *   - `wrapModelCall`   → `recordHarnessModelCall` on each LLM call;
 *                         on error, calls `failHarnessTurn` and rethrows.
 *                         (AfterAgent is a graph node reached only on the
 *                         success path; failed turns must be marked here
 *                         because the graph short-circuits on throw.)
 *   - `wrapToolCall`    → `beginHarnessToolCall` / `completeHarnessToolCall`
 *                         (existing) for the per-tool-call counter and
 *                         pendingWrites tracking.
 *
 * Storage is resolved per-call via `getRuntimeStorage()` so the middleware
 * reads the right `~/.deepagents/workspaces/<slug>/sessions/<sid>/` from the
 * AsyncLocalStorage context set up by the ACP session layer.
 */
export function createHarnessLifecycleMiddleware() {
  return createMiddleware({
    name: "harnessLifecycle",

    beforeAgent: async () => {
      beginHarnessTurn();
    },

    afterAgent: async () => {
      completeHarnessTurn();
    },

    wrapModelCall: async (request, handler) => {
      recordHarnessModelCall();
      try {
        return await handler(request);
      } catch (err) {
        failHarnessTurn(err);
        throw err;
      }
    },

    wrapToolCall: async (request, handler) => {
      const { id } = beginHarnessToolCall(
        request.toolCall.name,
        request.toolCall.args ?? {}
      );
      try {
        return await handler(request);
      } finally {
        completeHarnessToolCall(id);
      }
    },
  });
}

