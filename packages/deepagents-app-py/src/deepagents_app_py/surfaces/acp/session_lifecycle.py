"""ACP session-lifecycle patch.

Subclasses the official ``deepagents_acp.server.AgentServerACP`` to fill gaps
the 0.0.8 release leaves open. Mirrors the TS template's
``surfaces/acp/session-lifecycle.ts`` (which patches the same upstream server).

Currently fills:
  * **server name/version** — upstream ``initialize()`` returns no ``agent_info``,
    so ACP clients can't show the agent's identity; we advertise it here.
  * **mcp_servers forwarding** — upstream ``new_session()`` accepts but ignores
    the client's MCP servers; we store them on the session context so the
    per-session agent factory can pass them to ``build_agent_config_parts()``.
"""

from __future__ import annotations

from typing import Any

from deepagents_acp.server import AgentServerACP

from deepagents_app_py.runtime.logger import logger

log = logger.child("session-lifecycle")


class DeepAgentsAppServer(AgentServerACP):
    """``AgentServerACP`` that advertises the configured agent name/version."""

    def __init__(
        self,
        agent: Any,
        *,
        models: list[dict[str, str]] | None = None,
        server_name: str = "deepagents-app-py",
        server_version: str = "0.0.0",
    ) -> None:
        super().__init__(agent, models=models)
        self._server_name = server_name
        self._server_version = server_version

    async def initialize(
        self,
        protocol_version: int,
        client_capabilities: Any = None,
        client_info: Any = None,
        **kwargs: Any,
    ) -> Any:
        response = await super().initialize(
            protocol_version, client_capabilities, client_info, **kwargs
        )
        # Upstream leaves agent_info unset — advertise our identity so the ACP
        # client can display the agent name/version.
        try:
            from acp.schema import Implementation

            response.agent_info = Implementation(
                name=self._server_name, version=self._server_version
            )
        except Exception:  # noqa: BLE001 — name/version is best-effort metadata
            pass
        return response

    async def new_session(
        self,
        cwd: str,
        mcp_servers: list[Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        """Override to store session MCP servers on the context.

        Upstream discards *mcp_servers*; we attach them to the session context
        so the agent factory in ``config_builder.py`` can read them via
        ``ctx.mcp_servers``.
        """
        response = await super().new_session(cwd, mcp_servers=mcp_servers, **kwargs)

        if mcp_servers:
            log.info(
                "Session received MCP servers from ACP client",
                count=len(mcp_servers),
            )
            # Reset per-session MCP servers — each session gets a fresh set.
            try:
                self._session_mcp_servers: dict[str, Any] = {}
                for server in mcp_servers:
                    if isinstance(server, dict) and server.get("name"):
                        self._session_mcp_servers[server["name"]] = server
            except Exception:  # noqa: BLE001
                log.warn("Failed to store session MCP servers")

        return response
