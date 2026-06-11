"""Middleware layer — LangChain ``AgentMiddleware`` chain for the deep agent.

Port of the TS template's ``runtime/middleware/*``. Each middleware is a
``langchain.agents.middleware.AgentMiddleware`` passed to
``deepagents.create_deep_agent(middleware=[...])``.

Capability mapping (decision: prefer deepagents/langchain built-ins):

* compaction      → built-in ``SummarizationMiddleware``
* protected paths → deepagents ``FilesystemPermission(mode="deny")`` (wired in
  ``agent_config``), not a middleware
* relative paths  → deepagents ``FilesystemBackend(root_dir=...)`` handles it
* cost / loop / eviction / reminder / lifecycle → small custom middleware below
"""

from __future__ import annotations

from collections import deque
from pathlib import Path
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage, ToolMessage


def _messages(state: Any) -> list[Any]:
    """Read the message list from an agent state (dict or attr based)."""
    if isinstance(state, dict):
        return state.get("messages") or []
    return getattr(state, "messages", []) or []


class HarnessLifecycleMiddleware(AgentMiddleware):
    """Turn lifecycle hook point. No-op by default; extend in ``app/`` hooks.

    Kept as an explicit, always-first middleware so app code has a stable place
    to observe turn boundaries (mirrors the TS ``harness-lifecycle``).
    """

    def before_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:  # noqa: ARG002
        return None


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
                # Break the loop by returning an error result instead of running
                # the tool again (safer than raising, which would abort the run).
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


def should_evict(content: str, config: Any) -> bool:
    if not getattr(config, "enabled", True):
        return False
    char_per_token = getattr(config, "char_per_token", 4.0)
    token_limit = getattr(config, "token_limit", 20_000)
    return (len(content) / char_per_token) > token_limit


def create_preview(content: str, head_lines: int = 5, tail_lines: int = 5) -> str:
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


def build_middleware(config: Any, workspace_root: str | Path) -> list[AgentMiddleware]:  # noqa: ARG001
    """Assemble the ``AgentMiddleware`` chain from ``AppConfig``.

    ``workspace_root`` is accepted for signature parity with the TS builder and
    future path-aware middleware; relative-path resolution and protected paths
    are handled by the deepagents backend / ``permissions`` respectively.
    """
    mws: list[AgentMiddleware] = []
    if config is None:
        return mws

    mw = config.middleware

    # Always-first lifecycle hook point.
    mws.append(HarnessLifecycleMiddleware())

    if getattr(mw.periodic_reminder, "enabled", False):
        mws.append(
            PeriodicReminderMiddleware(
                first_at=mw.periodic_reminder.first_at,
                every=mw.periodic_reminder.every,
            )
        )

    if getattr(mw.cost_tracking, "enabled", False):
        mws.append(CostTrackingMiddleware(warn_at_tokens=mw.cost_tracking.warn_at_tokens))

    if getattr(mw.stuck_loop_detection, "enabled", False):
        mws.append(
            StuckLoopMiddleware(
                threshold=mw.stuck_loop_detection.threshold,
                mode=mw.stuck_loop_detection.mode,
            )
        )

    if getattr(config.eviction, "enabled", False):
        mws.append(EvictionMiddleware(config=config.eviction))

    # Context compaction is provided by deepagents' BUILT-IN summarization
    # middleware (create_deep_agent injects one), so we must not add another —
    # langchain's create_agent rejects duplicate middleware. The template's
    # ``compaction.*`` config is therefore governed by deepagents' model-aware
    # summarization defaults; to fully override it (custom summarizer model /
    # trigger), replace deepagents' default via ``create_summarization_middleware``.

    return mws


__all__ = [
    "CostTrackingMiddleware",
    "EvictionMiddleware",
    "HarnessLifecycleMiddleware",
    "PeriodicReminderMiddleware",
    "StuckLoopMiddleware",
    "build_middleware",
]
