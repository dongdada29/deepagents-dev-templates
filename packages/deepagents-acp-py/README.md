# deepagents-acp-py

ACP (Agent Client Protocol) server for Python agents — enables IDE integration with Zed, JetBrains, and other ACP clients.

## Installation

```bash
pip install deepagents-acp-py
```

## Usage

```python
from deepagents_acp_py import DeepAgentsServer, run_agent, SessionContext

def build_agent(ctx: SessionContext):
    # Create your agent here using ctx.model, ctx.cwd, etc.
    return my_agent

server = DeepAgentsServer(
    agent=build_agent,
    name="my-agent",
    models=[
        {"value": "anthropic:claude-sonnet-4-6", "name": "Claude Sonnet 4.6"},
        {"value": "anthropic:claude-opus-4-8", "name": "Claude Opus 4.8"},
    ],
)
run_agent(server)  # starts stdio ACP server
```

## License

MIT
