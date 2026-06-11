# DeepAgents Dev Templates — Python Template

## Tech Stack
- **Runtime**: LangGraph + deepagents (replaced pydantic-ai)
- **ACP Server**: deepagents-acp (stdio transport)
- **Model Providers**: Anthropic, OpenAI, Google Gemini, Groq (via LangChain)
- **Config**: Pydantic v2 models with camelCase JSON aliases
- **Tools**: LangChain `@tool` decorators
- **Middleware**: LangChain `AgentMiddleware` chain

## Structure
- `src/deepagents_app_py/` — Package source
  - `main.py` — CLI entrypoint (argparse command dispatch)
  - `runtime/` — Protected engine (config, middleware, platform, storage)
    - `agent_config.py` — `build_graph()` / `build_agent_config_parts()` — single source of truth
    - `config/` — 6-layer priority chain: defaults < user < project < template < env < session
    - `config/config_schema.py` — Pydantic `AppConfig` hierarchy (model, mcp, platform, permissions, sandbox, skills, memory, hooks, plugins, workspace, logging, compaction, eviction, middleware, agent)
    - `middleware/` — HarnessLifecycle, PeriodicReminder, CostTracking, StuckLoop, Eviction
    - `model.py` — `resolve_model()` / `resolve_summarizer_model()` (cached)
    - `permissions.py` — ask/yolo/plan modes → FilesystemPermission rules
    - `helpers.py` — System prompt assembly, skills/memory discovery
    - `discovery.py` — SKILL.md frontmatter parsing, sub-agent discovery
    - `logger.py` — Structured JSON logger with file tee
    - `code_graph.py` — Code relationship graph generator
    - `slash_commands/` — /help, /tools, /config, /clear, /save, /exit
  - `surfaces/` — ACP server and CLI entrypoints
    - `acp/server.py` — `bootstrap()` → config → factory → deepagents-acp
    - `acp/config_builder.py` — Agent factory (per-session graph rebuild, model override)
    - `acp/session_lifecycle.py` — `DeepAgentsAppServer` (server name/version)
    - `cli/repl.py` — Interactive REPL with prompt_toolkit + MemorySaver
    - `cli/one_shot.py` — Single prompt / file execution
  - `app/` — AI-editable business tools and hooks
    - `tools/` — LangChain @tool: http_request, runtime_info, json_utils, agent_variable, agent_memory, platform_api, mcp_bridge
- `prompts/` — System prompt files (target-agent.base.md, developer-agent.system.md, code-assistant.system.md, styles/)
- `skills/` — Skill definitions (builtin/, platform/)
- `config/` — JSON configuration (app-agent.config.json, mcp.default.json, platform.json, config-schema.json)
- `tests/` — Test suite (unit/, integration/, acp-smoke/, bundle-smoke/)

## Zone Rules (template.manifest.json)
- **protected**: `runtime/`, `surfaces/` — DO NOT modify unless explicitly asked
- **ai-editable**: `app/`, `prompts/`, `skills/` — AI agent can modify
- **user-platform**: `config/`, `agents/`, `.deepagents/` — End user config

## Commands
- Dev: `uv sync --group dev`
- Test: `uv run pytest`
- Lint: `uv run ruff check .`
- Type-check: `uv run pyright`
- Build: `uv build`
- Run REPL: `uv run deepagents-app-py chat`
- Run ACP: `uv run deepagents-app-py`

## Key Patterns
- `build_agent_config_parts()` in `agent_config.py` is the single source of truth for agent configuration — both ACP and CLI surfaces use it
- Config uses camelCase JSON keys internally; Pydantic schema auto-generates aliases via `to_camel`
- `collect_tools()` in `app/tools/__init__.py` returns all registered LangChain tools
- Middleware chain is assembled by `build_middleware()` in `runtime/middleware/__init__.py`
- ACP session config overrides are passed via `ACP_SESSION_CONFIG_JSON` env var
- Model instances are cached in module-level dicts to avoid re-instantiation

## Config Priority
```
AppConfig defaults
  → user ~/.deepagents/config.json (+ models.json, mcp.json)
    → project .deepagents/config.json (+ mcp.json)
      → template config/app-agent.config.json
        → environment variables (ENV_MAP in config_sources.py)
          → ACP session config (model, agentId, spaceId, cwd)
```

## Dependencies
- `deepagents ≥0.6.8` — Agent graph factory
- `deepagents-acp ≥0.0.8` — ACP server
- `langgraph ≥1.2.4` — State graph runtime
- `langchain ≥1.3.7` — Middleware, tools
- `langchain-anthropic`, `langchain-openai`, `langchain-google-genai` — Model providers
