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
) -> Any:
    """Return an async factory ``(AgentSessionContext) -> CompiledStateGraph``.

    The factory honors the per-session model override (``ctx.model`` is a
    ``"provider:model-name"`` string), so switching models in the ACP client
    actually rebuilds the agent with the new model.

    *server_instance* is the ``DeepAgentsAppServer`` instance. The factory
    reads ``server_instance._session_mcp_servers`` to pick up MCP servers
    forwarded by ``session_lifecycle.py``'s ``new_session()`` override. The
    upstream ``AgentSessionContext`` dataclass has no ``mcp_servers`` field,
    so we cannot pass them through ``ctx``.
    """
    from deepagents_app_py.runtime.agent_config import build_agent_config_parts

    base_model_str = f"{config.model.provider}:{config.model.name}"

    async def build_agent(ctx: Any) -> Any:
        from deepagents import create_deep_agent

        from deepagents_app_py.app.tools import collect_tools

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

        # Collect session-level MCP servers from the server instance.
        # The upstream AgentSessionContext has no mcp_servers field, so we
        # read from the server instance where session_lifecycle.py stores them.
        session_mcp_servers: dict[str, Any] | None = None
        if server_instance and hasattr(server_instance, "_session_mcp_servers"):
            session_mcp_servers = server_instance._session_mcp_servers

        parts = await build_agent_config_parts(
            cfg,
            session_config,
            cwd,
            collect_tools(),
            session_mcp_servers=session_mcp_servers,
        )
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
