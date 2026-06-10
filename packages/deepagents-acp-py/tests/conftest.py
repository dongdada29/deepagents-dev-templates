"""Test configuration and shared fixtures."""

from __future__ import annotations

import pytest

from deepagents_acp_py.session import SessionContext


@pytest.fixture
def sample_session() -> SessionContext:
    """Create a sample SessionContext for testing."""
    return SessionContext(session_id="abc123", cwd="/tmp/test", model="test-model")
