import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CAPABILITY_SOURCES = new Set([
  "acp-dynamic",
  "agent-builtin",
  "env-builtin",
  "package-placeholder",
  "future-durable-state",
]);

interface AgentSpec {
  schemaVersion: string;
  agent: {
    name: string;
    slug: string;
    summary: string;
  };
  sourceRequest: {
    userPrompt: string;
    clarifyingQuestions: string[];
  };
  coreTasks: string[];
  capabilityPlan: Record<string, string>;
  variables: Array<{
    name: string;
    type: string;
    source: string;
  }>;
  promptStructure: string[];
  acceptanceScenarios: string[];
  risksAndBoundaries: string[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf-8")) as T;
}

describe("scenario Agent Spec examples", () => {
  it("keeps the canonical Agent Spec example actionable and platform-safe", () => {
    const spec = readJson<AgentSpec>(".nuwax-agent/agent.spec.example.json");

    expect(spec.schemaVersion).toBe("nuwax.agent.spec.v1");
    expect(spec.agent.name).toBeTruthy();
    expect(spec.agent.slug).toMatch(/^[a-z0-9-]+$/);
    expect(spec.agent.summary.length).toBeGreaterThan(20);
    expect(spec.sourceRequest.userPrompt).toBeTruthy();
    expect(spec.sourceRequest.clarifyingQuestions.length).toBeGreaterThanOrEqual(2);
    expect(spec.coreTasks.length).toBeGreaterThanOrEqual(3);
    expect(spec.promptStructure).toContain("Tool Strategy");
    expect(spec.acceptanceScenarios.length).toBeGreaterThanOrEqual(3);
    expect(spec.risksAndBoundaries.length).toBeGreaterThanOrEqual(2);
  });

  it("uses only known capability source layers", () => {
    const spec = readJson<AgentSpec>(".nuwax-agent/agent.spec.example.json");

    for (const [capability, source] of Object.entries(spec.capabilityPlan)) {
      expect(CAPABILITY_SOURCES, capability).toContain(source);
    }
  });

  it("keeps variables as named placeholders instead of secret literals", () => {
    const spec = readJson<AgentSpec>(".nuwax-agent/agent.spec.example.json");
    const serialized = JSON.stringify(spec);

    expect(serialized).not.toMatch(/(?:sk|tp)-[A-Za-z0-9_-]{20,}/);
    expect(serialized).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
    expect(spec.variables.some((variable) => variable.type === "secret")).toBe(true);
    expect(spec.variables.every((variable) => /^[A-Z0-9_]+$/.test(variable.name))).toBe(true);
  });
});

