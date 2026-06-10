"""Tests for MCP bridge — ACP MCP format conversion."""

from __future__ import annotations

from deepagents_acp_py.mcp_bridge import convert_acp_mcp_servers


class TestConvertAcpMcpServers:
    def test_empty_list(self) -> None:
        assert convert_acp_mcp_servers([]) == {}

    def test_stdio_server(self) -> None:
        servers = [
            {
                "name": "my-server",
                "command": "npx",
                "args": ["-y", "some-mcp"],
                "env": [{"name": "API_KEY", "value": "secret"}],
            }
        ]
        result = convert_acp_mcp_servers(servers)
        assert "my-server" in result
        assert result["my-server"]["command"] == "npx"
        assert result["my-server"]["args"] == ["-y", "some-mcp"]
        assert result["my-server"]["env"] == {"API_KEY": "secret"}

    def test_stdio_without_env(self) -> None:
        servers = [
            {
                "name": "simple",
                "command": "uvx",
                "args": ["mcp-server"],
            }
        ]
        result = convert_acp_mcp_servers(servers)
        assert "simple" in result
        assert "env" not in result["simple"]

    def test_dict_env(self) -> None:
        servers = [
            {
                "name": "dict-env",
                "command": "node",
                "args": ["server.js"],
                "env": {"KEY": "val"},
            }
        ]
        result = convert_acp_mcp_servers(servers)
        assert result["dict-env"]["env"] == {"KEY": "val"}

    def test_http_server_skipped(self) -> None:
        servers = [
            {"name": "remote", "type": "http", "url": "https://mcp.example.com"},
        ]
        result = convert_acp_mcp_servers(servers)
        assert result == {}

    def test_sse_server_skipped(self) -> None:
        servers = [
            {"name": "remote", "type": "sse", "url": "https://mcp.example.com/events"},
        ]
        result = convert_acp_mcp_servers(servers)
        assert result == {}

    def test_no_name_skipped(self) -> None:
        servers = [
            {"command": "npx", "args": ["-y", "something"]},
        ]
        result = convert_acp_mcp_servers(servers)
        assert result == {}

    def test_mixed_servers(self) -> None:
        servers = [
            {
                "name": "local",
                "command": "uvx",
                "args": ["my-mcp"],
            },
            {"name": "remote", "type": "http", "url": "https://example.com"},
        ]
        result = convert_acp_mcp_servers(servers)
        assert len(result) == 1
        assert "local" in result
