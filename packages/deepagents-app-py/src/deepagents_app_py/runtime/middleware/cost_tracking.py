"""Cost tracking middleware — accumulate token usage, warn past threshold."""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware import AgentMiddleware


def _messages(state: Any) -> list[Any]:
    """Read the message list from an agent state (dict or attr based)."""
    if isinstance(state, dict):
        return state.get("messages") or []
    return getattr(state, "messages", []) or []


class CostTrackingMiddleware(AgentMiddleware):
    """Accumulate token usage across model calls; warn past a threshold."""

    def __init__(self, *, warn_at_tokens: int = 100_000) -> None:
        super().__init__()
        self.warn_at_tokens = warn_at_tokens
        self.total_tokens = 0
        self._warned = False

    def after_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:  # noqa: ARG002
        msgs = _messages(state)
        if msgs:
            usage = getattr(msgs[-1], "usage_metadata", None)
            if usage:
                self.total_tokens += int(usage.get("total_tokens", 0) or 0)
        if not self._warned and self.total_tokens >= self.warn_at_tokens:
            self._warned = True
            from deepagents_app_py.runtime.logger import logger

            logger.child("cost").warn(
                "Token usage exceeded threshold",
                total_tokens=self.total_tokens,
                warn_at_tokens=self.warn_at_tokens,
            )
        return None
