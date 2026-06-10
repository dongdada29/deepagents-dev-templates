"""deepagents-acp-py — ACP (Agent Client Protocol) server for Python agents.

Provides a high-level ``DeepAgentsServer`` class that implements the ACP protocol
over stdio, enabling IDE integration with Zed, JetBrains, and other ACP clients.

Usage::

    from deepagents_acp_py import DeepAgentsServer, run_agent, SessionContext

    def build_agent(ctx: SessionContext):
        # Create your agent here, using ctx.model, ctx.cwd, etc.
        return my_agent

    server = DeepAgentsServer(
        agent=build_agent,
        name="my-agent",
        models=[
            {"value": "anthropic:claude-sonnet-4-6", "name": "Claude Sonnet 4.6"},
        ],
    )
    run_agent(server)
"""

from deepagents_acp_py._version import __version__
from deepagents_acp_py.helpers import run_agent
from deepagents_acp_py.server import DeepAgentsServer
from deepagents_acp_py.session import SessionContext, SessionManager

__all__ = [
    "DeepAgentsServer",
    "SessionContext",
    "SessionManager",
    "__version__",
    "run_agent",
]
