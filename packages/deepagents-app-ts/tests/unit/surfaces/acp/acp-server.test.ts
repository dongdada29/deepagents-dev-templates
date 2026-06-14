import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../../../src/runtime/config/config-loader.js";

// resolveModel instantiates a real ChatAnthropic/ChatOpenAI; mock it to avoid
// requiring credentials in unit tests that only verify config/permission assembly.
vi.mock("../../../../src/runtime/model.js", () => ({
  resolveModel: () => ({ invoke: async () => ({ content: "" }) }),
  resolveModelString: (config: { model: { provider: string; name: string } }) =>
    `${config.model.provider}:${config.model.name}`,
}));
import { buildACPAgentConfig, loadSessionConfigFromEnv } from "../../../../src/surfaces/acp/server.js";
import { createRuntimeContextAsync, discoverMemoryFiles, resolveSkillsPaths, resolveSystemPrompt } from "../../../../src/runtime/helpers.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ACP server config", () => {
  const originalEnv = { ...process.env };
  let envHome: string;

  beforeEach(() => {
    envHome = mkdtempSync(join(tmpdir(), "acp-config-home-"));
    process.env.DEEPAGENTS_HOME = envHome;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    rmSync(envHome, { recursive: true, force: true });
  });

  it("uses session prompt and model when building the ACP agent config", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "acp-config-test-"));
    try {
      const sessionConfig = {
        systemPrompt: "Prompt supplied by ACP/platform",
        model: "claude-session-model",
        agentId: "agent-1",
        spaceId: "space-1",
        mcpServers: {
          context7: { command: "context7", args: [] },
        },
      };
      const config = loadConfig({
        configPath: "/nonexistent.json",
        sessionConfig,
      });

      const agentConfig = buildACPAgentConfig(config, workspaceRoot, sessionConfig);

      expect(agentConfig.systemPrompt).toContain("Prompt supplied by ACP/platform");
      expect(agentConfig.systemPrompt).toContain(`Effective workspace root: ${workspaceRoot}`);
      expect(typeof agentConfig.model).not.toBe("string");
      expect(agentConfig.tools?.map((tool) => tool.name)).toContain("runtime_info");
      expect(agentConfig.tools?.map((tool) => tool.name)).not.toContain("mcp_tool_bridge");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("injects platform conventions into discovered subagents", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "subagent-conv-test-"));
    try {
      // A declarative subagent under the default ./.agents/agents/ directory.
      const agentDir = join(workspaceRoot, ".agents", "agents", "researcher");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, "AGENT.md"),
        [
          "---",
          "name: researcher",
          "description: Deep research helper",
          "---",
          "You are a focused research assistant.",
        ].join("\n"),
        "utf-8"
      );

      const config = loadConfig({ configPath: "/nonexistent.json", workspaceRoot });
      const agentConfig = buildACPAgentConfig(config, workspaceRoot, undefined);

      const researcher = agentConfig.subagents?.find(
        (sub) => (sub as { name?: string }).name === "researcher"
      ) as { systemPrompt?: string } | undefined;

      expect(researcher).toBeDefined();
      // The AGENT.md body is preserved …
      expect(researcher?.systemPrompt ?? "").toContain("focused research assistant");
      // … and the platform conventions are appended, since discovered subagents
      // inherit the main agent's toolset. This is the coverage the removed
      // harness profile used to (try to) provide for every agent.
      expect(researcher?.systemPrompt ?? "").toContain("Tool Selection Priority (MANDATORY)");
      expect(researcher?.systemPrompt ?? "").toContain("agent_variable");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads startup session config from ACP_SESSION_CONFIG_JSON", () => {
    process.env.ACP_SESSION_CONFIG_JSON = JSON.stringify({
      model: "claude-from-env-session",
      agentId: "agent-env",
      spaceId: "space-env",
    });

    expect(loadSessionConfigFromEnv()).toEqual({
      model: "claude-from-env-session",
      agentId: "agent-env",
      spaceId: "space-env",
    });
  });

  it("resolves configured system prompt and lets ACP session prompt win", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "prompt-config-test-"));
    try {
      const config = loadConfig({
        configPath: "/nonexistent.json",
        workspaceRoot,
      });
      config.agent.systemPrompt = "Configured prompt";

      expect(resolveSystemPrompt(config, undefined, workspaceRoot)).toContain("Configured prompt");
      // The ACP session prompt wins the priority chain AND has the platform
      // conventions appended (it is supplied externally and does not carry
      // them). See runtime/prompt.ts + app/harness-profile.ts.
      const acpResolved = resolveSystemPrompt(config, { systemPrompt: "ACP prompt" }, workspaceRoot);
      expect(acpResolved.startsWith("ACP prompt")).toBe(true);
      expect(acpResolved).toContain("Tool Selection Priority (MANDATORY)");
      expect(acpResolved).toContain("agent_variable");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("discovers root AGENTS.md and can disable workspace instructions", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agents-md-test-"));
    try {
      const agentsPath = join(workspaceRoot, "AGENTS.md");
      writeFileSync(agentsPath, "# Instructions", "utf-8");
      expect(discoverMemoryFiles(workspaceRoot)).toContain("./AGENTS.md");
      expect(discoverMemoryFiles(workspaceRoot, false)).toEqual([]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("resolves user and project skill paths without treating ~ as relative", () => {
    const config = loadConfig({ configPath: "/nonexistent.json" });
    const skills = resolveSkillsPaths(config);

    expect(skills.some((path) => path.endsWith("/.deepagents/skills"))).toBe(true);
    expect(skills).toContain("./.deepagents/skills");
    expect(skills).not.toContain("./~/.deepagents/skills");
  });

  it("hydrates platform MCP components and lets session MCP override them", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      components: [
        {
          componentId: "platform-email",
          type: "mcp",
          config: {
            name: "email",
            command: "platform-email",
            args: ["serve"],
          },
        },
        {
          componentId: "platform-docs",
          type: "mcp",
          config: {
            mcpServer: {
              url: "https://mcp.example.test/docs",
            },
          },
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const sessionConfig = {
      agentId: "agent-1",
      spaceId: "space-1",
      mcpServers: {
        email: { command: "session-email", args: ["serve"] },
      },
    };
    const config = loadConfig({
      configPath: "/nonexistent.json",
      sessionConfig,
    });

    const context = await createRuntimeContextAsync(config, sessionConfig);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(context.mcpManager.getServer("email")?.command).toBe("session-email");
    expect(context.mcpManager.getServer("platform-docs")?.url).toBe("https://mcp.example.test/docs");
  });
});
