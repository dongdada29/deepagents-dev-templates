# QuickStart

## Prerequisites

- Python ≥ 3.11
- [uv](https://docs.astral.sh/uv/) package manager
- An API key for at least one LLM provider (Anthropic, OpenAI, Google, or Groq)

## Installation

```bash
# Clone and enter the package
cd packages/deepagents-app-py

# Install dependencies
uv sync

# (Optional) Install dev dependencies
uv sync --group dev
```

## Configuration

Set your API key in a `.env` file or environment variable:

```bash
# Anthropic (default)
export ANTHROPIC_API_KEY="sk-ant-..."

# Or OpenAI
export OPENAI_API_KEY="sk-..."

# Or Google
export GOOGLE_API_KEY="AIza..."
```

The agent auto-detects the provider from available keys. Override explicitly with:

```bash
export LLM_PROVIDER="openai"
export DEFAULT_MODEL="gpt-4o"
```

## Usage

### Interactive REPL

```bash
uv run deepagents-app-py chat

# With debug logging
uv run deepagents-app-py chat --debug
```

The REPL supports:
- Multi-turn conversation (MemorySaver checkpointer)
- Slash commands: `/help`, `/tools`, `/config`, `/clear`, `/save`, `/exit`
- Ctrl+D to quit

### One-Shot Prompt

```bash
# Direct prompt
uv run deepagents-app-py ask "Explain the architecture of this project"

# From a file
uv run deepagents-app-py run prompt.md
```

### ACP Server (IDE Integration)

```bash
# Start ACP server over stdio (default command)
uv run deepagents-app-py

# With custom workspace
uv run deepagents-app-py --cwd /path/to/project

# With custom config
uv run deepagents-app-py --config ./my-config.json
```

The ACP server is compatible with nuwaclaw, Zed, and other ACP clients.

### Code Graph

```bash
# Print code graph to stdout
uv run deepagents-app-py graph

# Write to file
uv run deepagents-app-py graph code-graph.json
```

## Development

```bash
# Run tests
uv run pytest

# Lint
uv run ruff check .

# Type check
uv run pyright

# Build wheel
uv build
```

## Customization

### Add Tools

Edit `src/deepagents_app_py/app/tools/` — add a new `@tool` function and register it in `__init__.py`:

```python
from langchain_core.tools import tool

@tool
def my_custom_tool(query: str) -> str:
    """Description of what this tool does."""
    return "result"
```

Then add `my_custom_tool` to `collect_tools()` in `app/tools/__init__.py`.

### Add Skills

Create a `SKILL.md` file in `skills/builtin/` or `skills/platform/`:

```markdown
---
name: my-skill
description: What this skill does
version: 0.1.0
tags: [custom]
---

# My Skill
Instructions for the agent...
```

### Change Model

Edit `config/app-agent.config.json`:

```json
{
  "model": {
    "provider": "openai",
    "name": "gpt-4o"
  }
}
```

Or set environment variables: `LLM_PROVIDER=openai DEFAULT_MODEL=gpt-4o`

### Change Permission Mode

```json
{
  "permissions": {
    "mode": "plan"
  }
}
```

Modes: `ask` (HITL), `plan` (present plan first), `yolo` (autonomous).
