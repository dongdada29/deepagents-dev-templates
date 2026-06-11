"""Harness lifecycle middleware — turn boundary hook point."""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware import AgentMiddleware


class HarnessLifecycleMiddleware(AgentMiddleware):
    """Turn lifecycle hook point. No-op by default; extend in ``app/`` hooks.

    Kept as an explicit, always-first middleware so app code has a stable place
    to observe turn boundaries (mirrors the TS ``harness-lifecycle``).
    """

    def before_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:  # noqa: ARG002
        return None
