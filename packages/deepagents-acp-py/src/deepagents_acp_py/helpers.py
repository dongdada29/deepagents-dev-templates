"""Helper utilities for the ACP server.

Provides prompt text extraction, tool kind mapping, and the ``run_agent()``
convenience entry point.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from acp.schema import TextContentBlock

if TYPE_CHECKING:
    from acp import Agent

logger = logging.getLogger(__name__)

# Default mapping: tool name → ACP tool kind string.
# Users can override via DeepAgentsServer(tool_kind_map={...}).
DEFAULT_TOOL_KIND_MAP: dict[str, str] = {
    "read_file": "read",
    "edit_file": "edit",
    "write_file": "edit",
    "ls": "search",
    "glob": "search",
    "grep": "search",
    "execute": "execute",
    "web_search": "search",
    "web_fetch": "fetch",
    "bash": "execute",
    "run": "execute",
}


def extract_prompt_text(prompt: list[Any]) -> str:
    """Extract plain text from an ACP prompt (list of content blocks).

    Handles ``TextContentBlock`` instances and generic objects with a
    ``.text`` attribute.
    """
    parts: list[str] = []
    for block in prompt:
        if isinstance(block, TextContentBlock):
            parts.append(block.text)
        elif hasattr(block, "text"):
            parts.append(str(block.text))
    return "".join(parts)


def run_agent(agent: Agent, *, debug: bool = False) -> None:
    """Convenience entry point — start an ACP agent on stdio.

    Wraps ``acp.run_agent()`` with standard configuration::

        from deepagents_acp_py import DeepAgentsServer, run_agent

        server = DeepAgentsServer(agent=my_agent)
        run_agent(server)  # blocks, runs on stdin/stdout
    """
    from acp import run_agent as _acp_run_agent

    if debug:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.WARNING)

    logger.info("Starting ACP agent on stdio")
    asyncio.run(_acp_run_agent(agent))
