"""Conversation checkpoint tool — save, list, rewind, delete conversation checkpoints.

Checkpoints capture the current conversation state so the agent
can recover from mistakes or explore alternative approaches.

Inspired by pydantic-deepagents' CheckpointToolset.
"""

from __future__ import annotations

import os
import random
import re
import string
from datetime import datetime, timezone
from pathlib import Path

from langchain_core.tools import tool


# ---------------------------------------------------------------------------
# Path helpers (follow agent_memory pattern — derive from env / cwd)
# ---------------------------------------------------------------------------

def _working_dir() -> Path:
    """Resolve the working directory."""
    return Path(os.environ.get("DEEPAGENTS_WORKING_DIR", os.getcwd()))


def _session_id() -> str:
    """Resolve the current session ID from env or fall back to *default*."""
    return (
        os.environ.get("DEEPAGENTS_SESSION_ID")
        or os.environ.get("ACP_SESSION_ID")
        or "default"
    )


def _checkpoints_dir() -> Path:
    """Active checkpoints directory under the current session dir."""
    return _working_dir() / ".agent-sessions" / _session_id() / "checkpoints"


def _legacy_checkpoints_dir() -> Path:
    """Legacy ``.agent-checkpoints/`` directory (read-only)."""
    return _working_dir() / ".agent-checkpoints"


# ---------------------------------------------------------------------------
# ID helpers
# ---------------------------------------------------------------------------

def _sanitize_id(id_str: str) -> str:
    """Sanitize a checkpoint ID to prevent path traversal."""
    name = os.path.basename(id_str)
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)


def _generate_checkpoint_id() -> str:
    """Generate a unique checkpoint ID: ``cp-{timestamp}-{random}``."""
    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y-%m-%dT%H-%M-%S")
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"cp-{ts}-{rand}"


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

def _save(description: str | None) -> str:
    checkpoints_dir = _checkpoints_dir()
    checkpoints_dir.mkdir(parents=True, exist_ok=True)

    cp_id = _generate_checkpoint_id()
    path = checkpoints_dir / f"{cp_id}.md"

    lines = [
        f"# Checkpoint: {cp_id}",
        f"Created: {datetime.now(timezone.utc).isoformat()}",
    ]
    if description:
        lines.append(f"Description: {description}")
    lines += [
        "",
        "## Context",
        "This checkpoint was saved so the conversation can be rewound to this point.",
        "To rewind: use the `rewind` operation with this checkpoint ID.",
        "",
        "## State Snapshot",
        "The agent should describe the current state here when saving:",
        "- What has been done so far",
        "- What remains to be done",
        "- Any important decisions made",
        "- Key file paths or code references",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return f"Checkpoint saved: {cp_id}\nPath: {path}\nUse this ID to rewind later."


def _list(max_results: int) -> str:
    active_dir = _checkpoints_dir()
    legacy_dir = _legacy_checkpoints_dir()

    active_files = sorted(active_dir.glob("cp-*.md")) if active_dir.exists() else []
    legacy_files = sorted(legacy_dir.glob("cp-*.md")) if legacy_dir.exists() else []

    # Deduplicate by filename
    seen: set[str] = set()
    all_files: list[Path] = []
    for f in list(reversed(active_files)) + list(reversed(legacy_files)):
        if f.name not in seen:
            seen.add(f.name)
            all_files.append(f)

    all_files = all_files[:max_results]

    if not all_files:
        return "No checkpoints found. Use `save` to create one."

    listings: list[str] = []
    for f in all_files:
        content = f.read_text(encoding="utf-8")
        desc_match = re.search(r"^Description: (.+)$", content, re.MULTILINE)
        time_match = re.search(r"^Created: (.+)$", content, re.MULTILINE)
        cp_id = f.stem
        line = f"- {cp_id} ({time_match.group(1) if time_match else 'unknown time'})"
        if desc_match:
            line += f": {desc_match.group(1)}"
        listings.append(line)

    return f"Checkpoints ({len(all_files)}):\n" + "\n".join(listings)


def _rewind(checkpoint_id: str) -> str:
    safe_id = _sanitize_id(checkpoint_id)
    active_path = _checkpoints_dir() / f"{safe_id}.md"
    legacy_path = _legacy_checkpoints_dir() / f"{safe_id}.md"

    readable_path = active_path if active_path.exists() else legacy_path

    if not readable_path.exists():
        available = [
            f.stem
            for f in sorted(_checkpoints_dir().glob("cp-*.md"))
        ] if _checkpoints_dir().exists() else []
        avail_str = ", ".join(available) or "none"
        return f'Checkpoint "{safe_id}" not found. Available: {avail_str}'

    content = readable_path.read_text(encoding="utf-8")
    return "\n".join([
        f"REWINDING TO CHECKPOINT: {safe_id}",
        "",
        content,
        "",
        "---",
        "You are now rewound to this checkpoint. Continue from where this checkpoint was saved.",
        "Ignore any work done AFTER this checkpoint. Start fresh from the state described above.",
    ])


def _delete(checkpoint_id: str) -> str:
    safe_id = _sanitize_id(checkpoint_id)
    delete_path = _checkpoints_dir() / f"{safe_id}.md"

    if not delete_path.exists():
        return (
            f'Checkpoint "{safe_id}" not found in active session storage. '
            "Legacy checkpoints are read-only."
        )

    delete_path.unlink()
    return f'Checkpoint "{checkpoint_id}" deleted.'


# ---------------------------------------------------------------------------
# Public tool
# ---------------------------------------------------------------------------

@tool
def conversation_checkpoint(
    operation: str,
    checkpointId: str | None = None,
    description: str | None = None,
    maxResults: int | None = None,
) -> str:
    """Save, list, rewind to, or delete conversation checkpoints.
    Checkpoints capture the current state so you can recover from mistakes or try alternatives.

    Operations:
    - save: Save a checkpoint of the current conversation state
    - list: List all saved checkpoints
    - rewind: Rewind to a specific checkpoint (restores context)
    - delete: Delete a checkpoint

    Args:
        operation: One of ``save``, ``list``, ``rewind``, ``delete``.
        checkpointId: Checkpoint ID (required for rewind/delete).
        description: Description for save operation.
        maxResults: Max results for list (default: 10).
    """
    try:
        if operation == "save":
            return _save(description)
        if operation == "list":
            return _list(maxResults or 10)
        if operation == "rewind":
            if not checkpointId:
                return "Error: checkpointId is required for rewind operation"
            return _rewind(checkpointId)
        if operation == "delete":
            if not checkpointId:
                return "Error: checkpointId is required for delete operation"
            return _delete(checkpointId)
        return f"Unknown operation: {operation!r} (use save|list|rewind|delete)"
    except Exception as exc:
        return f"Checkpoint operation failed: {exc}"
