"""Agent config parts builder — composes kwargs for ``create_deep_agent()``.

Port of the TS template's ``src/runtime/agent-config.ts``. Assembles the
keyword arguments for ``deepagents.create_deep_agent(**parts)`` (LangGraph):
model, system prompt, tools (builtin + MCP), the LangChain
``AgentMiddleware`` chain, subagents, skills, memory, deepagents
``FilesystemPermission`` rules, interrupt-on (HITL), and the checkpointer.

This is the single source of truth — both the ACP surface and the CLI surfaces
build their agent from these parts so behavior is identical across surfaces.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from deepagents import FilesystemPermission

from deepagents_app_py.runtime.config.config_schema import ACPSessionConfig, AppConfig
from deepagents_app_py.runtime.helpers import (
    discover_memory_files,
    format_skills_summary,
    resolve_skills_paths,
    resolve_system_prompt,
    with_runtime_context_prompt,
)
from deepagents_app_py.runtime.logger import logger
from deepagents_app_py.runtime.middleware import build_middleware
from deepagents_app_py.runtime.model import resolve_model
from deepagents_app_py.runtime.permissions import build_interrupt_on, build_permissions

_PLAN_PREAMBLE = (
    "## Planning Mode\n"
    "Before making any changes, you MUST:\n"
    "1. Present a clear plan of what you intend to do\n"
    "2. Wait for user approval\n"
    "3. Only then proceed with execution\n\n"
)


def build_agent_config_parts(
    config: AppConfig,
    session_config: ACPSessionConfig | None,
    workspace_root: Path | str,
    tools: list[Any],
    *,
    checkpointer: Any = None,
) -> dict[str, Any]:
    """Compose the keyword arguments for ``deepagents.create_deep_agent(**parts)``.

    This is the **sync** variant — MCP tools should be pre-loaded and included
    in *tools* before calling this. The async CLI surfaces can use
    ``build_graph()`` which handles MCP loading internally.

    Returns a dict with keys: ``model``, ``system_prompt``, ``tools``,
    ``middleware``, ``subagents``, ``skills``, ``memory``, ``permissions``,
    ``interrupt_on``, ``checkpointer``.
    """
    log = logger.child("agent-config")

    # ── System prompt ──────────────────────────────────────────────────
    system_prompt = with_runtime_context_prompt(
        resolve_system_prompt(config, session_config, workspace_root),
        workspace_root,
    )

    # ── Mode-based overrides ──────────────────────────────────────────
    mode = config.permissions.mode or "ask"
    interrupt_on = build_interrupt_on(config.permissions.interrupt_on or [])
    if mode == "plan":
        system_prompt = _PLAN_PREAMBLE + system_prompt
    elif mode == "yolo":
        interrupt_on = {}

    # ── Permissions (allow + protected-path deny) → FilesystemPermission ──
    permissions = [
        FilesystemPermission(
            operations=rule["operations"],
            paths=rule["paths"],
            mode=rule["mode"],
        )
        for rule in build_permissions(config, workspace_root)
    ]

    # ── Middleware chain (LangChain AgentMiddleware) ──────────────────
    middleware = build_middleware(config, workspace_root)

    # ── Skills & Memory ───────────────────────────────────────────────
    skills_paths = resolve_skills_paths(config)
    memory_paths = discover_memory_files(
        workspace_root, config.agent.include_workspace_instructions
    )

    # ── Skills summary in system prompt (progressive loading) ─────────
    from deepagents_app_py.runtime.discovery import discover_skills

    skill_descriptors = discover_skills(skills_paths, workspace_root=Path(workspace_root))
    if skill_descriptors:
        summary = format_skills_summary(skill_descriptors)
        system_prompt += f"\n\n## Available Skills\n{summary}"

    # ── Subagents ─────────────────────────────────────────────────────
    from deepagents_app_py.runtime.helpers import discover_sub_agents as _discover_subs

    raw_subagents = _discover_subs(config, workspace_root)
    subagents: list[dict[str, Any]] | None = None
    if raw_subagents:
        subagents = [
            {
                "name": sub["name"],
                "description": sub["description"],
                "system_prompt": sub.get("body", ""),
            }
            for sub in raw_subagents
        ]

    parts: dict[str, Any] = {
        "model": resolve_model(config),
        "system_prompt": system_prompt,
        "tools": tools,
        "middleware": middleware,
        "subagents": subagents,
        "skills": skills_paths or None,
        "memory": memory_paths or None,
        "permissions": permissions or None,
        "interrupt_on": interrupt_on or None,
        "checkpointer": checkpointer,
    }

    log.info(
        "Agent config parts built",
        name=config.agent.name,
        model=config.model.name,
        provider=config.model.provider,
        mode=mode,
        tools=len(tools),
        subagents=len(subagents) if subagents else 0,
        skills=len(skills_paths),
        middleware=len(middleware),
    )

    return parts


def build_graph(
    config: AppConfig,
    session_config: ACPSessionConfig | None,
    workspace_root: Path | str,
    tools: list[Any],
    *,
    checkpointer: Any = None,
) -> Any:
    """Build a compiled deepagents graph from config (sync, for ACP factory)."""
    from deepagents import create_deep_agent

    return create_deep_agent(
        **build_agent_config_parts(
            config, session_config, workspace_root, tools, checkpointer=checkpointer
        )
    )


async def build_graph_with_mcp(
    config: AppConfig,
    session_config: ACPSessionConfig | None,
    workspace_root: Path | str,
    tools: list[Any],
    *,
    checkpointer: Any = None,
) -> Any:
    """Build graph with async MCP tool loading (for CLI surfaces)."""
    import asyncio

    from deepagents import create_deep_agent

    from deepagents_app_py.app.tools.mcp_bridge import collect_mcp_servers, load_mcp_tools

    mcp_servers = collect_mcp_servers(config)
    mcp_tools = await load_mcp_tools(mcp_servers)
    all_tools = list(tools) + mcp_tools

    parts = build_agent_config_parts(
        config, session_config, workspace_root, all_tools, checkpointer=checkpointer
    )
    return create_deep_agent(**parts)
