"""Periodic reminder middleware — inject reminder SystemMessage every N turns."""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage


class PeriodicReminderMiddleware(AgentMiddleware):
    """Inject a short reminder SystemMessage every ``every`` turns."""

    def __init__(self, *, first_at: int = 5, every: int = 10, reminder: str | None = None) -> None:
        super().__init__()
        self.first_at = first_at
        self.every = every
        self.reminder = reminder or (
            "Stay focused on the user's overall goal and respect the workspace "
            "and permission constraints."
        )
        self._turn = 0

    def before_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:  # noqa: ARG002
        self._turn += 1
        t = self._turn
        if t == self.first_at or (t > self.first_at and (t - self.first_at) % self.every == 0):
            return {"messages": [SystemMessage(content=f"[reminder] {self.reminder}")]}
        return None
