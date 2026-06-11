"""Stuck loop detection middleware — detect repeated identical tool calls."""

from __future__ import annotations

from collections import deque
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage


class StuckLoopMiddleware(AgentMiddleware):
    """Detect ``threshold`` identical tool calls in a row and optionally break."""

    def __init__(self, *, threshold: int = 3, mode: str = "warn") -> None:
        super().__init__()
        self.threshold = threshold
        self.mode = mode
        self._recent: deque[str] = deque(maxlen=threshold)

    def wrap_tool_call(self, request: Any, handler: Any) -> Any:
        name = (request.tool_call or {}).get("name", "") or ""
        self._recent.append(name)
        if (
            len(self._recent) == self.threshold
            and len(set(self._recent)) == 1
            and name
        ):
            from deepagents_app_py.runtime.logger import logger

            logger.child("stuck-loop").warn(
                "Repeated identical tool call", tool=name, threshold=self.threshold
            )
            if self.mode == "error":
                return ToolMessage(
                    content=(
                        f"[stuck-loop] '{name}' was called {self.threshold} times in a "
                        "row. Stop repeating this call and try a different approach."
                    ),
                    tool_call_id=(request.tool_call or {}).get("id", ""),
                    name=name,
                    status="error",
                )
        return handler(request)

    async def awrap_tool_call(self, request: Any, handler: Any) -> Any:
        name = (request.tool_call or {}).get("name", "") or ""
        self._recent.append(name)
        if (
            len(self._recent) == self.threshold
            and len(set(self._recent)) == 1
            and name
        ):
            from deepagents_app_py.runtime.logger import logger

            logger.child("stuck-loop").warn(
                "Repeated identical tool call", tool=name, threshold=self.threshold
            )
            if self.mode == "error":
                return ToolMessage(
                    content=(
                        f"[stuck-loop] '{name}' was called {self.threshold} times in a "
                        "row. Stop repeating this call and try a different approach."
                    ),
                    tool_call_id=(request.tool_call or {}).get("id", ""),
                    name=name,
                    status="error",
                )
        return await handler(request)
