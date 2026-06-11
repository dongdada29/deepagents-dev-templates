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

Modules:
* ``harness_lifecycle`` — always-first turn boundary hook
* ``periodic_reminder`` — inject reminder SystemMessage every N turns
* ``cost_tracking`` — token usage accumulator with threshold warning
* ``stuck_loop`` — detect repeated identical tool calls
* ``eviction`` — truncate oversized tool outputs
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langchain.agents.middleware import AgentMiddleware

from deepagents_app_py.runtime.middleware.cost_tracking import CostTrackingMiddleware
from deepagents_app_py.runtime.middleware.eviction import EvictionMiddleware
from deepagents_app_py.runtime.middleware.harness_lifecycle import HarnessLifecycleMiddleware
from deepagents_app_py.runtime.middleware.periodic_reminder import PeriodicReminderMiddleware
from deepagents_app_py.runtime.middleware.stuck_loop import StuckLoopMiddleware


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
