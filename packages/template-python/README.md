# DeepAgents Dev Templates — Python

A Python port of the TypeScript `packages/template` agent template, built on
[pydantic-ai](https://github.com/pydantic/pydantic-ai) and
[pydantic-deepagents](https://github.com/pydantic/pydantic-deepagents).

## QuickStart

```bash
uv sync
uv run deepagents-app-py chat
```

## Commands

| Command | Description |
|---------|-------------|
| `deepagents-app-py` | Start ACP server (stdio) |
| `deepagents-app-py chat` | Interactive REPL |
| `deepagents-app-py ask "..."` | One-shot prompt |
| `deepagents-app-py run <file>` | Run prompt from file |
| `deepagents-app-py graph` | Generate code graph |

## Development

```bash
uv sync --group dev
uv run pytest
uv run ruff check .
uv run pyright
uv build
```
