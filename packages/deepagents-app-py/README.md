# DeepAgents Dev Templates — Python

Python application agent template built on [LangGraph](https://github.com/langchain-ai/langgraph) + [deepagents](https://github.com/nicholasgasior/deepagents). Provides a production-ready ACP server (stdio), interactive REPL, and one-shot CLI for building AI agents with tools, skills, middleware, and platform integration.

> **Version**: 0.2.11 · **Python**: ≥3.11 · **Framework**: LangGraph + deepagents

## Quick Start

```bash
# Install dependencies
uv sync

# Interactive REPL
uv run deepagents-app-py chat

# One-shot prompt
uv run deepagents-app-py ask "What can you do?"

# ACP server (stdio — for IDE / nuwaclaw integration)
uv run deepagents-app-py

# Run prompt from file
uv run deepagents-app-py run prompt.md
```

## Commands

| Command | Description |
|---------|-------------|
| `deepagents-app-py` | Start ACP server (stdio transport) |
| `deepagents-app-py acp` | Explicitly start the ACP server |
| `deepagents-app-py chat` | Interactive REPL with multi-turn history |
| `deepagents-app-py ask "<prompt>"` | One-shot prompt, print response |
| `deepagents-app-py run <file>` | Run a prompt read from a file |
| `deepagents-app-py graph [out.json]` | Generate code relationship graph JSON |

### Common Flags

| Flag | Description |
|------|-------------|
| `--debug` | Enable debug-level logging |
| `--config <path>` | Use a custom config file |
| `--prompt-file <path>` | Use a custom system prompt file |
| `--system-prompt <s>` | Directly set the system prompt |
| `--cwd <path>` | Set the project workspace root |
| `--no-acp` | Force non-ACP mode |

## Architecture

```
src/deepagents_app_py/
├── main.py                    # CLI entrypoint — command dispatch
├── runtime/                   # Protected engine (do not modify)
│   ├── agent_config.py        # Agent factory — build_graph() / build_agent_config_parts()
│   ├── config/                # 6-layer config priority chain
│   │   ├── config_schema.py   # Pydantic models (AppConfig hierarchy)
│   │   ├── config_loader.py   # Orchestrates: defaults < user < project < template < env < session
│   │   ├── config_merge.py    # Layered merge with array-concat semantics
│   │   ├── config_sources.py  # File, env, plugin overlays
│   │   ├── config_paths.py    # Path resolution (~/.deepagents, etc.)
│   │   └── deep_merge.py      # Generic recursive dict merge
│   ├── middleware/             # LangChain AgentMiddleware chain
│   │   └── __init__.py        # HarnessLifecycle, PeriodicReminder, CostTracking, StuckLoop, Eviction
│   ├── platform/              # MCP manager, platform client, variable manager
│   ├── storage/               # Harness lifecycle, session state, approvals
│   ├── slash_commands/        # Built-in slash command system (/help, /tools, /config, etc.)
│   ├── permissions.py         # Permission modes: ask / yolo / plan
│   ├── model.py               # Model resolution (Anthropic/OpenAI/Google/Groq)
│   ├── helpers.py             # System prompt assembly, skills/memory discovery
│   ├── discovery.py           # Skill, memory, sub-agent discovery (SKILL.md frontmatter)
│   ├── logger.py              # Structured JSON logger with file tee
│   ├── prompt.py              # Prompt composition helpers
│   ├── code_graph.py          # Code relationship graph generator
│   ├── string.py              # Slugify, truncate helpers
│   └── acp_server_internals.py # Version detection, session ID
├── surfaces/                  # Entry surfaces
│   ├── acp/                   # ACP server (stdio transport)
│   │   ├── server.py          # bootstrap() — wires config → factory → deepagents-acp
│   │   ├── config_builder.py  # Agent factory (per-session graph rebuild)
│   │   ├── session_lifecycle.py # DeepAgentsAppServer (server name/version)
│   │   └── slash_command_handler.py # Delegated to deepagents-acp-py
│   └── cli/                   # Terminal surfaces
│       ├── repl.py            # Interactive REPL with prompt_toolkit
│       ├── one_shot.py        # Single prompt / file execution
│       └── extract_content.py # Response text extraction
└── app/                       # AI-editable zone
    └── tools/                 # LangChain @tool implementations
        ├── http_request.py    # HTTP client tool
        ├── runtime_info.py    # Runtime introspection
        ├── json_utils.py      # JSON manipulation
        ├── agent_variable.py  # Agent variable CRUD
        ├── agent_memory.py    # Agent memory management
        ├── platform_api.py    # Nuwax platform API
        └── mcp_bridge.py      # MCP server bridge
```

### Configuration Priority Chain

```
defaults < user ~/.deepagents < project .deepagents < template config < env vars < ACP session
```

Config files use camelCase JSON keys. The Pydantic schema (`config_schema.py`) accepts both camelCase and snake_case.

### Key Dependencies

| Package | Role |
|---------|------|
| `deepagents ≥0.6.8` | Agent graph factory (`create_deep_agent`) |
| `deepagents-acp ≥0.0.8` | ACP server over stdio |
| `langgraph ≥1.2.4` | Agent state graph runtime |
| `langchain ≥1.3.7` | Agent middleware, tools |
| `langchain-anthropic` | Anthropic model provider |
| `langchain-openai` | OpenAI model provider |
| `langchain-google-genai` | Google Gemini provider |

## Configuration

Default config: `config/app-agent.config.json`

```json
{
  "agent": { "name": "deepagents-template", "outputStyle": "concise" },
  "model": { "provider": "anthropic", "name": "claude-sonnet-4-6" },
  "permissions": {
    "mode": "ask",
    "interruptOn": ["write", "edit", "execute"],
    "allowedPaths": ["src/app/", "prompts/", "skills/", "config/"],
    "deniedPaths": ["src/runtime/", "src/surfaces/"]
  }
}
```

### Permission Modes

| Mode | Behavior |
|------|----------|
| `ask` | HITL — interrupt on write/edit/execute, ask user approval |
| `plan` | Inject planning preamble — agent must present plan before changes |
| `yolo` | No interrupts — full autonomous execution |

### Environment Variables

| Variable | Maps To |
|----------|---------|
| `ANTHROPIC_API_KEY` | Model auth |
| `OPENAI_API_KEY` | Model auth |
| `LLM_PROVIDER` | `model.provider` |
| `DEFAULT_MODEL` / `ANTHROPIC_MODEL` | `model.name` |
| `DEEPAGENTS_WORKING_DIR` | `workspace.workingDir` |
| `PLATFORM_API_BASE_URL` | `platform.apiBaseUrl` |
| `LOG_LEVEL` | `logging.level` |
| `DEEPAGENTS_PERMISSIONS_MODE` | `permissions.mode` |
| `ACP_SESSION_CONFIG_JSON` | ACP session overrides |

## Middleware

The agent uses a LangChain `AgentMiddleware` chain:

| Middleware | Default | Purpose |
|-----------|---------|---------|
| `HarnessLifecycleMiddleware` | Always on | Turn lifecycle hook point |
| `PeriodicReminderMiddleware` | On | Inject focus reminder every N turns |
| `CostTrackingMiddleware` | On | Token usage tracking + warning |
| `StuckLoopMiddleware` | On | Detect repeated identical tool calls |
| `EvictionMiddleware` | On | Truncate oversized tool outputs |

Context compaction is provided by deepagents' built-in `SummarizationMiddleware`.

## Development

```bash
# Install dev dependencies
uv sync --group dev

# Run tests
uv run pytest

# Lint
uv run ruff check .

# Type check
uv run pyright

# Build package
uv build
```

### Zone Rules (template.manifest.json)

| Zone | Paths | Who Edits |
|------|-------|-----------|
| `protected` | `runtime/`, `surfaces/` | Template maintainer only |
| `ai-editable` | `app/`, `prompts/`, `skills/` | AI agent |
| `user-platform` | `config/`, `agents/`, `.deepagents/` | End user |

## Slash Commands (REPL)

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/tools` | List available tools |
| `/config` | Show current configuration |
| `/clear` | Clear screen |
| `/save <path>` | Save conversation history |
| `/exit` `/quit` | Exit REPL |

## License

MIT
