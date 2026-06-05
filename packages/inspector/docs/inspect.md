# DeepAgents Orchestration Spec

The inspector produces an `AgentOrchestrationSpec` — a structured JSON snapshot of a DeepAgents template app.

## Modes

- **dry-run** (default): reads config and runtime metadata only. No LLM client, no LangGraph compilation. Works without model credentials.
- **full** (`--full`): creates the real agent via `createAppAgentAsync`, introspects the compiled LangGraph graph. Requires `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `OPENAI_API_KEY`. Graph introspection failures become warnings — they never block the spec.

## Spec Reference

The top-level shape (see `src/types.ts` for the full TypeScript types):

```json
{
  "schema": "nuwaclaw.agent-orchestration.v1",
  "generatedAt": "2026-06-05T...",
  "framework": "deepagents",
  "packageVersion": "0.1.0",
  "mode": "dry-run | full",
  "meta": { "agentName", "model", "permissionsMode", "workspaceRoot" },
  "systemPrompt": { "source", "resolved", "charCount", "truncated" },
  "tools": [ { "name", "description", "kind", "source" } ],
  "subagents": [ { "name", "description", "source", "systemPrompt" } ],
  "skills": { "directories": [], "files": [ { "name", "source", "path" } ] },
  "memory": { "enabled", "files", "absolutePaths", "addCacheControl" },
  "middleware": [ { "name", "factory", "order", "enabled", "config", "source" } ],
  "permissions": { "mode", "deniedPaths", "allowedPaths", "interruptOn", "effectiveRules" },
  "graph": { "nodes", "edges", "conditionalBranches", "mermaid", "stats" } | null,
  "warnings": []
}
```

### Truncation rules

- `systemPrompt.resolved`: max 50 KB, `truncated: true` if exceeded
- `subagents[].systemPrompt`: max 4 KB, `truncated: true` if exceeded
- `tools[].schemaPreview`: max 2 KB
- Absolute paths are preserved; the UI visually de-emphasizes home-directory paths

### Graph (full mode only)

- `graph.stats`: node count, edge count, conditional edge count, hasSubgraphs
- `graph.nodes[]`: `{ id, name, type }` — type is one of `agent`, `tool`, `boundary`, `node`
- `graph.edges[]`: `{ source, target, data?, conditional }` — `data` is the edge label
- `graph.conditionalBranches[]`: extracted from `agent.graph.builder.branches` (best-effort, never fails the spec)
- `graph.mermaid`: full Mermaid source string

## Example (dry-run)

```bash
npm run inspect -w packages/inspector -- --out /tmp/spec.json --no-open
```

Produces a JSON file with 14 tools, 8 middleware entries, 15 skills, and `graph: null`.

## Example (full)

```bash
npm run inspect -w packages/inspector -- --full --out /tmp/spec-full.json --no-open
```

Adds the compiled LangGraph topology: typically 15-20 nodes, 15-20 edges, 5+ conditional edges, and a Mermaid diagram.

## Browser UI

`npm run inspect -w packages/inspector` starts a local server on port 7322 (auto-increments to 7332 if busy).

- **Graph tab**: React Flow canvas of the LangGraph topology. Click any node to see its metadata. Blue = agent/model, green = tool, orange = boundary (`__start__`/`__end__`).
- **Pipeline tab**: ordered middleware chain. Enabled steps are opaque; disabled steps are faded.
- **Resources tab**: flat list of tools, skills, subagents, and memory files.
- **JSON tab**: raw spec as a fallback (works offline, no CDN required).

### Offline fallback

The HTML page fetches `/api/spec` synchronously before loading React. If the CDN is unreachable or JavaScript is disabled, the raw JSON is displayed as a `<pre>` block.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Full inspection failed: ... api key ...` | Missing model credentials in `--full` mode | Set `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `OPENAI_API_KEY`, or run without `--full` |
| `graph: null` with warning "does not expose getGraphAsync" | LangGraph version doesn't match the expected API shape | Update `@langchain/langgraph` to v1.x+ |
| `warnings` includes "Failed to render Mermaid graph" | The graph contains characters Mermaid can't parse | The spec is still valid; graph tab won't render but JSON/pipeline/resources tabs work |
| Port 7322 already in use | Another inspector or service is running | Server auto-increments to 7323, 7324, ..., 7332 |
| `npm run inspect` fails with "Cannot find module" | Template hasn't been built, or `INSPECTOR_TEMPLATE_SOURCE` not set in dev | Run `npm run build -w packages/template`, or set `INSPECTOR_TEMPLATE_SOURCE=1` for source imports |

## Reading the Results

### Pipeline vs Graph

The **Pipeline tab** shows middleware in declaration order (as written in `helpers.ts`). The **Graph tab** shows the same middleware as compiled LangGraph nodes — each middleware appears split across `before_agent`, `before_model`, and `after_model` hook points. Together they show the mapping from "what I wrote" to "what actually runs."

### Conditional edges

Edges marked `conditional: true` are LangGraph routing decisions. The agent decides which path to take at runtime. In the default template, two nodes have conditional branches:

- `HumanInTheLoopMiddleware.after_model` — routes to `todoListMiddleware` for tool calls, or back to `model_request`
- `todoListMiddleware.after_model` — routes to `tools`, `model_request`, or `__end__`

### Middleware order

The dry-run pipeline order should match the LangGraph node chain order. If they don't, the template's `buildAgentConfigParts` may have diverged from the compiled middleware — the inspector makes that visible.
