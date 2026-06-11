"""Conversation history tool — search and browse archived conversation history.

Searches through archived conversation history files.
deepagents' summarization middleware offloads old messages to
``conversation_history/{thread_id}.md`` before compression.
This tool lets the agent search through that history to recover
details lost during summarization.

Inspired by pydantic-deepagents' search_conversation_history tool.
"""

from __future__ import annotations

import os
from pathlib import Path

from langchain_core.tools import tool


_HISTORY_DIR = "conversation_history"
_TRUNCATE_LIMIT = 10_000


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def _working_dir() -> Path:
    """Resolve the working directory."""
    return Path(os.environ.get("DEEPAGENTS_WORKING_DIR", os.getcwd()))


def _history_dir() -> Path:
    """Return the conversation history directory."""
    return _working_dir() / _HISTORY_DIR


# ---------------------------------------------------------------------------
# Search helpers
# ---------------------------------------------------------------------------

def _search_lines(content: str, query: str, max_results: int) -> list[str]:
    """Simple relevance scoring: count keyword occurrences.

    Port of the TS ``searchLines`` function.
    - Split query into terms (>2 chars), score by occurrence count per line.
    - +3 bonus for full query match.
    - Include 2 lines of context before and after each match.
    """
    query_lower = query.lower()
    query_terms = [t for t in query_lower.split() if len(t) > 2]
    lines = content.split("\n")

    # Score each line
    scored: list[tuple[int, int]] = []  # (line_num_0based, score)
    for i, line in enumerate(lines):
        line_lower = line.lower()
        score = sum(1 for term in query_terms if term in line_lower)
        if query_lower in line_lower:
            score += 3
        if score > 0:
            scored.append((i, score))

    # Sort by score descending
    scored.sort(key=lambda x: x[1], reverse=True)

    results: list[str] = []
    seen: set[int] = set()
    for line_idx, score in scored[:max_results]:
        if line_idx in seen:
            continue
        seen.add(line_idx)

        # Include 2 lines of context before and after
        start = max(0, line_idx - 2)
        end = min(len(lines), line_idx + 3)
        excerpt = "\n".join(lines[start:end])
        results.append(f"[Line {line_idx + 1}, score: {score}]\n{excerpt}")

    return results


def _truncate(value: str, limit: int = _TRUNCATE_LIMIT) -> str:
    """Truncate *value* to at most *limit* characters."""
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

def _list_history() -> str:
    hist_dir = _history_dir()
    if not hist_dir.exists():
        return (
            "No conversation history found. "
            "History is created when summarization middleware offloads old messages."
        )

    archived = sorted(f.name for f in hist_dir.glob("*.md"))
    if not archived:
        return "No conversation history files found."

    return (
        f"Found {len(archived)} history file(s):\n"
        + "\n".join(f"- {name}" for name in archived)
    )


def _search_history(query: str, max_results: int) -> str:
    if not query:
        return "Error: query is required for search operation"

    hist_dir = _history_dir()
    if not hist_dir.exists():
        return "No conversation history directory found."

    files = sorted(hist_dir.glob("*.md"))
    if not files:
        return "No conversation history files to search."

    all_results: list[str] = []
    for f in files:
        content = f.read_text(encoding="utf-8")
        matches = _search_lines(content, query, max_results)
        if matches:
            all_results.append(f"\n## {f.name}")
            all_results.extend(matches)

    if not all_results:
        return f'No matches found for "{query}" in conversation history.'

    return f'Search results for "{query}":\n' + "\n\n".join(all_results)


def _read_history() -> str:
    hist_dir = _history_dir()
    if not hist_dir.exists():
        return "No conversation history directory found."

    all_files = sorted(hist_dir.glob("*.md"))
    if not all_files:
        return "No conversation history files found."

    # Read the most recent file (last when sorted alphabetically)
    latest = all_files[-1]
    content = latest.read_text(encoding="utf-8")
    return _truncate(content)


# ---------------------------------------------------------------------------
# Public tool
# ---------------------------------------------------------------------------

@tool
def conversation_history(
    operation: str,
    query: str | None = None,
    maxResults: int | None = None,
) -> str:
    """Search and browse archived conversation history.
    History is automatically created when the summarization middleware compresses old messages.

    Operations:
    - list: List all history archive files
    - search: Search history by keyword (returns matching excerpts with context)
    - read: Read the most recent history file

    Args:
        operation: One of ``list``, ``search``, ``read``.
        query: Search keywords (required for search operation).
        maxResults: Max results to return (default: 5).
    """
    try:
        if operation == "list":
            return _list_history()
        if operation == "search":
            return _search_history(query or "", max_results or 5)
        if operation == "read":
            return _read_history()
        return f"Unknown operation: {operation!r} (use list|search|read)"
    except Exception as exc:
        return f"History operation failed: {exc}"
