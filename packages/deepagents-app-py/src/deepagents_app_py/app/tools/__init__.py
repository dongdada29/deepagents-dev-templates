"""App tools — AI-editable LangChain tools.

Each module exports a LangChain ``@tool``. ``collect_tools()`` returns the list
passed to ``deepagents.create_deep_agent(tools=...)``.

MCP tools are loaded separately via ``load_mcp_tools()`` in
``mcp_bridge.py`` and merged with the builtin tools at agent-creation time.
"""

from __future__ import annotations

from langchain_core.tools import BaseTool

from deepagents_app_py.app.tools.agent_memory import agent_memory
from deepagents_app_py.app.tools.agent_variable import agent_variable
from deepagents_app_py.app.tools.checkpoint import conversation_checkpoint
from deepagents_app_py.app.tools.conversation_history import conversation_history
from deepagents_app_py.app.tools.http_request import http_request
from deepagents_app_py.app.tools.json_utils import json_utils
from deepagents_app_py.app.tools.plan_task import plan_task
from deepagents_app_py.app.tools.platform_api import platform_api
from deepagents_app_py.app.tools.runtime_info import runtime_info
from deepagents_app_py.app.tools.task import task


def collect_tools() -> list[BaseTool]:
    """Return the custom builtin app tools for ``create_deep_agent(tools=...)``."""
    return [
        http_request,
        runtime_info,
        json_utils,
        agent_variable,
        agent_memory,
        plan_task,
        task,
        platform_api,
        conversation_checkpoint,
        conversation_history,
    ]


__all__ = [
    "agent_memory",
    "agent_variable",
    "collect_tools",
    "conversation_checkpoint",
    "conversation_history",
    "http_request",
    "json_utils",
    "plan_task",
    "platform_api",
    "runtime_info",
    "task",
]
