"""ACP agent factory — builds a deepagents ``CompiledStateGraph`` per session.

Mirrors the TS ``surfaces/acp/config-builder.ts``. The official
``deepagents_acp.server.AgentServerACP`` takes either a compiled graph or a
factory ``(AgentSessionContext) -> CompiledStateGraph``; we return the factory
so each session (and model switch) rebuilds via ``create_deep_agent`` using the
shared ``build_agent_config_parts`` assembler.
"""

from __future__ import annotations

import json
import os
from typing import Any

from deepagents_app_py.runtime.logger import logger

log = logger.child("acp-config")


def build_acp_agent_factory(
    config: Any,
    workspace_root: str,
    server_instance: Any = None,
    session_config: Any | None = None,
    mcp_tools: list[Any] | None = None,
) -> Any:
    """Return a sync factory ``(AgentSessionContext) -> CompiledStateGraph``.

    The factory honors the per-session model override (``ctx.model`` is a
    ``"provider:model-name"`` string), so switching models in the ACP client
    actually rebuilds the agent with the new model.

    *mcp_tools* are pre-loaded MCP tools (loaded once at bootstrap via
    ``load_mcp_tools_from_config``) so the sync factory can include them
    without needing async.

    *server_instance* is the ``DeepAgentsAppServer`` — the factory reads
    ``server_instance._session_mcp_servers`` for per-session MCP overrides.
    """
    from deepagents import create_deep_agent

    from deepagents_app_py.app.tools import collect_tools

    base_model_str = f"{config.model.provider}:{config.model.name}"
    builtin_tools = collect_tools()
    preloaded_mcp = mcp_tools or []

    def build_agent(ctx: Any) -> Any:
        cwd = getattr(ctx, "cwd", None) or workspace_root
        cfg = config

        # Per-session model override → rebuild config with the selected model.
        model_override = getattr(ctx, "model", None)
        if model_override and ":" in model_override and model_override != base_model_str:
            try:
                cfg = config.model_copy(deep=True)
                provider, _, name = model_override.partition(":")
                cfg.model.provider = provider
                cfg.model.name = name
            except Exception:  # noqa: BLE001 — fall back to the configured model
                log.warn("Could not apply session model override", model=model_override)
                cfg = config

        all_tools = builtin_tools + preloaded_mcp

        # Build config parts synchronously (MCP tools already pre-loaded).
        from deepagents_app_py.runtime.agent_config import build_agent_config_parts_sync

        parts = build_agent_config_parts_sync(cfg, session_config, cwd, all_tools)
        return create_deep_agent(**parts)

    return build_agent


def load_session_config_from_env() -> dict | None:
    """Parse ``ACP_SESSION_CONFIG_JSON`` (mirrors the TS helper)."""
    raw = os.environ.get("ACP_SESSION_CONFIG_JSON")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        log.warn("Failed to parse ACP_SESSION_CONFIG_JSON")
        return None
