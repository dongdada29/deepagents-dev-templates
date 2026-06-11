"""MCP tool loader — loads native LangChain tools from configured MCP servers.

Uses ``langchain-mcp-adapters`` ``MultiServerMCPClient`` to connect to MCP
servers (stdio / HTTP / SSE) and register their tools as LangChain
``BaseTool`` instances.  These are merged with the builtin tools and passed
to ``create_deep_agent(tools=[...builtin, ...mcp])`` so the agent calls MCP
tools directly by name — no bridge indirection needed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from langchain_core.tools import BaseTool

from deepagents_app_py.runtime.logger import logger

log = logger.child("mcp-loader")


def _load_mcp_config_file(path: str | Path) -> dict[str, Any]:
    """Load a ``mcp.json`` file and return its ``servers`` dict."""
    p = Path(path).expanduser().resolve()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data.get("servers", {}) if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError) as exc:
        log.warn("Failed to load MCP config file", path=str(p), error=str(exc))
        return {}


def collect_mcp_servers(config: Any, session_mcp_servers: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge MCP server configs from all sources.

    Priority (later wins): ``config_path`` file < ``config_paths`` files <
    inline ``config.mcp.servers`` < ``session_mcp_servers``.
    """
    merged: dict[str, Any] = {}

    # 1. config_path (single file, e.g. ./config/mcp.default.json)
    mcp_cfg = getattr(config, "mcp", None)
    if mcp_cfg:
        config_path = getattr(mcp_cfg, "config_path", None)
        if config_path:
            merged.update(_load_mcp_config_file(config_path))

        # 2. config_paths (additional files)
        for extra_path in getattr(mcp_cfg, "config_paths", []) or []:
            merged.update(_load_mcp_config_file(extra_path))

        # 3. Inline servers from config
        inline = getattr(mcp_cfg, "servers", None)
        if inline and isinstance(inline, dict):
            merged.update(inline)

    # 4. Session overlay (from ACP client)
    if session_mcp_servers and isinstance(session_mcp_servers, dict):
        merged.update(session_mcp_servers)

    return merged


def _to_client_format(servers: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Convert MCPManager-style config to ``MultiServerMCPClient`` format.

    The client expects ``{"name": {"transport": "stdio"|"http", ...}}``.
    If no ``transport`` is specified, infer from the presence of ``command`` vs ``url``.
    """
    out: dict[str, dict[str, Any]] = {}
    for name, cfg in servers.items():
        if not isinstance(cfg, dict):
            continue
        entry = dict(cfg)
        if "transport" not in entry:
            if entry.get("url"):
                entry["transport"] = "http"
            elif entry.get("command"):
                entry["transport"] = "stdio"
            else:
                log.warn("Cannot determine transport for MCP server, skipping", name=name)
                continue
        out[name] = entry
    return out


async def load_mcp_tools(servers: dict[str, Any]) -> list[BaseTool]:
    """Connect to MCP servers and return their tools as ``BaseTool`` instances.

    Returns an empty list if *servers* is empty or all connections fail.
    """
    if not servers:
        return []

    client_config = _to_client_format(servers)
    if not client_config:
        return []

    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient

        client = MultiServerMCPClient(client_config)
        tools = await client.get_tools()
        log.info(
            "Loaded MCP tools",
            servers=list(client_config.keys()),
            tools=len(tools),
        )
        return tools
    except Exception as exc:  # noqa: BLE001 — degrade gracefully
        log.warn(
            "Failed to load MCP tools, continuing without them",
            servers=list(client_config.keys()),
            error=str(exc),
        )
        return []
