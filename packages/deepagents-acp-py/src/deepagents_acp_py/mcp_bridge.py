"""MCP server bridge — converts ACP session MCP configs to internal format.

When an ACP client (Zed/IDE) sends ``mcpServers`` in a ``session/new`` request,
this module converts the ACP format to a standard dict-of-dicts config that
consumers can feed to their MCP manager.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def convert_acp_mcp_servers(
    mcp_servers: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Convert ACP ``mcpServers`` list to a ``{name: config}`` dict.

    ACP format (from IDE)::

        [
            {"name": "my-server", "command": "npx", "args": ["-y", "pkg"],
             "env": [{"name": "KEY", "value": "val"}]},
            {"name": "remote", "type": "http", "url": "https://..."},
        ]

    Output format::

        {
            "my-server": {
                "command": "npx",
                "args": ["-y", "pkg"],
                "env": {"KEY": "val"},
            },
        }

    Currently only stdio-type servers are converted. HTTP/SSE servers are
    logged as unsupported and skipped.
    """
    result: dict[str, dict[str, Any]] = {}

    for server in mcp_servers:
        name = server.get("name", "")
        if not name:
            logger.warning("Skipping MCP server entry without name: %s", server)
            continue

        server_type = server.get("type", "stdio")

        if server_type in ("http", "sse"):
            logger.warning(
                "Skipping non-stdio MCP server '%s' (type=%s) — not yet supported",
                name,
                server_type,
            )
            continue

        # Stdio server
        config: dict[str, Any] = {}
        if "command" in server:
            config["command"] = server["command"]
        if "args" in server:
            config["args"] = server["args"]

        # Convert env from [{name, value}] to {name: value}
        raw_env = server.get("env")
        if raw_env:
            if isinstance(raw_env, list):
                config["env"] = {
                    entry["name"]: entry["value"]
                    for entry in raw_env
                    if "name" in entry and "value" in entry
                }
            elif isinstance(raw_env, dict):
                config["env"] = raw_env

        if config:
            result[name] = config

    return result
