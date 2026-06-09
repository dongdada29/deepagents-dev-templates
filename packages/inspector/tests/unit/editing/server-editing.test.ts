import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadTemplateRuntime } from "../../../src/template-runtime.js";
import { startInspectServer, type InspectServerHandle } from "../../../src/server.js";
import { inspectAgent, defaultStaticDir } from "../../../src/inspector.js";
import { hashContent } from "../../../src/editing/paths.js";

let root: string;
let handle: InspectServerHandle;
const CFG = "config/app-agent.config.json";

beforeEach(async () => {
  const templateRoot = resolve(process.cwd(), "../template");
  root = mkdtempSync(join(tmpdir(), "inspector-srv-"));
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(
    join(root, CFG),
    readFileSync(join(templateRoot, "config/app-agent.config.json"), "utf-8"),
    "utf-8"
  );
  const runtime = await loadTemplateRuntime();
  const spec = await inspectAgent({ workspaceRoot: root, configPath: CFG });
  handle = await startInspectServer({
    spec,
    staticDir: defaultStaticDir(),
    port: 7400,
    portRangeEnd: 7450,
    editing: { runtime, workspaceRoot: root, configPath: CFG },
  });
});
afterEach(async () => {
  await handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe("editing endpoints", () => {
  it("POST /api/preview returns a config diff", async () => {
    const res = await fetch(`${handle.url}/api/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "model.name": "gpt-4o" }, text: [] }),
    });
    const body = await res.json();
    expect(body.validation.ok).toBe(true);
    expect(body.files[0].after).toContain("gpt-4o");
  });

  it("POST /api/apply writes and returns a fresh spec", async () => {
    const res = await fetch(`${handle.url}/api/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "agent.name": "renamed-agent" }, text: [] }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.spec.meta.agentName).toBe("renamed-agent");
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).agent.name).toBe("renamed-agent");
  });

  it("POST /api/apply rejects invalid config with 422", async () => {
    const res = await fetch(`${handle.url}/api/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "permissions.mode": "nope" }, text: [] }),
    });
    expect(res.status).toBe(422);
  });
});
