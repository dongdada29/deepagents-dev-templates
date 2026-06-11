"""ACP server — bootstraps the official ``deepagents-acp`` server over stdio.

Mirrors the TS ``surfaces/acp/server.ts``: load config, build the agent factory
(``create_deep_agent`` per session), then start ``deepagents_acp``'s
``AgentServerACP`` over stdin/stdout via ``acp.run_agent``.

The official server already provides LangGraph streaming, HITL/permission
prompts, model switching, todo/plan updates and multimodal input. Gaps it does
*not* cover (slash commands, ACP MCP forwarding, configurable server
name/version, session list/close) are layered on by the ``session_lifecycle`` /
``slash_command_handler`` patch modules.
"""

from __future__ import annotations

import asyncio
import os

from deepagents_app_py.runtime.logger import logger


async def _bootstrap_async(
    *,
    acp: bool = True,
    debug: bool = False,
    config_path: str | None = None,
    workspace_root: str | None = None,
) -> None:
    """Async bootstrap — loads MCP tools, builds factory, starts server."""
    log = logger.child("acp-server")
    if debug:
        os.environ.setdefault("LOG_LEVEL", "debug")

    from deepagents_app_py.runtime.config.config_loader import loadConfig
    from deepagents_app_py.surfaces.acp.config_builder import (
        build_acp_agent_factory,
        load_session_config_from_env,
    )

    ws = workspace_root or os.getcwd()
    config = loadConfig({"configPath": config_path, "workspaceRoot": ws})
    session_config = load_session_config_from_env()
    if session_config:
        log.info("Loaded ACP session config from environment")

    # Pre-load MCP tools once at bootstrap (async).
    from deepagents_app_py.app.tools.mcp_bridge import collect_mcp_servers, load_mcp_tools

    mcp_servers = collect_mcp_servers(config)
    mcp_tools = await load_mcp_tools(mcp_servers)
    if mcp_tools:
        log.info("Pre-loaded MCP tools", count=len(mcp_tools), servers=list(mcp_servers.keys()))

    if not acp:
        log.info("ACP mode disabled — skipping server start")
        return

    from acp import run_agent as run_acp_agent

    from deepagents_app_py.surfaces.acp.session_lifecycle import DeepAgentsAppServer

    try:
        from deepagents_app_py.runtime.acp_server_internals import read_package_version

        pkg_version = read_package_version() or "0.0.0"
    except Exception:  # noqa: BLE001 — version metadata is best-effort
        pkg_version = "0.0.0"

    # Agent factory — sync, uses pre-loaded MCP tools.
    factory = build_acp_agent_factory(
        config, ws, session_config=session_config, mcp_tools=mcp_tools
    )

    server = DeepAgentsAppServer(
        agent=factory,
        models=[{"value": f"{config.model.provider}:{config.model.name}", "name": config.model.name}],
        server_name=config.agent.name or "deepagents-app-py",
        server_version=getattr(config.agent, "version", None) or pkg_version,
    )

    log.info(
        "Starting ACP server",
        name=config.agent.name,
        model=config.model.name,
        workspaceRoot=ws,
        mcpTools=len(mcp_tools),
    )
    await run_acp_agent(server)


def bootstrap(
    *,
    acp: bool = True,
    debug: bool = False,
    config_path: str | None = None,
    workspace_root: str | None = None,
) -> None:
    """Bootstrap and start the ACP server over stdin/stdout (sync entry point)."""
    asyncio.run(
        _bootstrap_async(
            acp=acp,
            debug=debug,
            config_path=config_path,
            workspace_root=workspace_root,
        )
    )
