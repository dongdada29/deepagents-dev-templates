"""Eviction middleware — truncate oversized tool outputs to head/tail preview."""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage


def should_evict(content: str, config: Any) -> bool:
    """Check whether tool output exceeds the configured token budget."""
    if not getattr(config, "enabled", True):
        return False
    char_per_token = getattr(config, "char_per_token", 4.0)
    token_limit = getattr(config, "token_limit", 20_000)
    return (len(content) / char_per_token) > token_limit


def create_preview(content: str, head_lines: int = 5, tail_lines: int = 5) -> str:
    """Build a head/tail preview with truncated middle."""
    lines = content.split("\n")
    if len(lines) <= head_lines + tail_lines:
        return content
    head = "\n".join(lines[:head_lines])
    tail = "\n".join(lines[-tail_lines:])
    omitted = len(lines) - head_lines - tail_lines
    return f"{head}\n\n... [{omitted} lines truncated] ...\n\n{tail}"


class EvictionMiddleware(AgentMiddleware):
    """Truncate oversized tool outputs to a head/tail preview."""

    def __init__(self, *, config: Any) -> None:
        super().__init__()
        self.config = config

    def wrap_tool_call(self, request: Any, handler: Any) -> Any:  # noqa: ARG002
        result = handler(request)
        if (
            isinstance(result, ToolMessage)
            and isinstance(result.content, str)
            and should_evict(result.content, self.config)
        ):
            result.content = create_preview(
                result.content,
                head_lines=getattr(self.config, "head_lines", 5),
                tail_lines=getattr(self.config, "tail_lines", 5),
            )
        return result

    async def awrap_tool_call(self, request: Any, handler: Any) -> Any:  # noqa: ARG002
        result = await handler(request)
        if (
            isinstance(result, ToolMessage)
            and isinstance(result.content, str)
            and should_evict(result.content, self.config)
        ):
            result.content = create_preview(
                result.content,
                head_lines=getattr(self.config, "head_lines", 5),
                tail_lines=getattr(self.config, "tail_lines", 5),
            )
        return result
