import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { inspectAgent } from "../../src/inspector.js";

const templateRoot = resolve(process.cwd(), "../deepagents-app-ts");

describe("inspectAgent", () => {
  it("creates a dry-run spec without requiring model credentials", async () => {
    const spec = await inspectAgent({
      workspaceRoot: templateRoot,
      configPath: "config/app-agent.config.json",
    });

    expect(spec.mode).toBe("dry-run");
    expect(spec.graph).toBeNull();
    expect(spec.meta.agentName).toBe("deepagents-app-ts");
    expect(spec.tools.length).toBeGreaterThanOrEqual(8);
  });
});
