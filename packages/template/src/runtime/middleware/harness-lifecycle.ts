import { createMiddleware } from "langchain";
import {
  beginHarnessToolCall,
  completeHarnessToolCall,
  recordHarnessModelCall,
} from "../harness-lifecycle.js";

export function createHarnessLifecycleMiddleware() {
  return createMiddleware({
    name: "harnessLifecycle",

    wrapModelCall: async (request, handler) => {
      recordHarnessModelCall();
      return handler(request);
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

