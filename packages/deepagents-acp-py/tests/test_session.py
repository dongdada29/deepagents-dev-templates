"""Tests for SessionContext and SessionManager."""

from __future__ import annotations

from deepagents_acp_py.session import SessionContext, SessionManager


class TestSessionContext:
    def test_create_defaults(self) -> None:
        ctx = SessionContext(session_id="test")
        assert ctx.session_id == "test"
        assert ctx.cwd == "."
        assert ctx.model is None
        assert ctx.mode == "agent"
        assert ctx.message_count == 0
        assert ctx.history == []
        assert ctx.extra == {}

    def test_create_with_params(self) -> None:
        ctx = SessionContext(
            session_id="abc",
            cwd="/tmp/project",
            model="claude-sonnet-4-6",
            mode="plan",
        )
        assert ctx.cwd == "/tmp/project"
        assert ctx.model == "claude-sonnet-4-6"
        assert ctx.mode == "plan"

    def test_touch_updates_timestamp(self, sample_session: SessionContext) -> None:
        old_ts = sample_session.last_activity_at
        sample_session.touch()
        assert sample_session.last_activity_at >= old_ts


class TestSessionManager:
    def test_track_and_get(self) -> None:
        mgr = SessionManager()
        ctx = SessionContext(session_id="s1")
        mgr.track(ctx)
        assert mgr.has("s1")
        assert mgr.get("s1") is ctx

    def test_get_missing(self) -> None:
        mgr = SessionManager()
        assert mgr.get("nope") is None
        assert not mgr.has("nope")

    def test_close(self) -> None:
        mgr = SessionManager()
        ctx = SessionContext(session_id="s1")
        mgr.track(ctx)
        removed = mgr.close("s1")
        assert removed is ctx
        assert not mgr.has("s1")
        assert mgr.close("nope") is None

    def test_list(self) -> None:
        mgr = SessionManager()
        mgr.track(SessionContext(session_id="s1"))
        mgr.track(SessionContext(session_id="s2"))
        sessions = mgr.list()
        assert len(sessions) == 2

    def test_count(self) -> None:
        mgr = SessionManager()
        assert mgr.count() == 0
        mgr.track(SessionContext(session_id="s1"))
        assert mgr.count() == 1
        mgr.track(SessionContext(session_id="s2"))
        assert mgr.count() == 2

    def test_touch(self) -> None:
        mgr = SessionManager()
        ctx = SessionContext(session_id="s1")
        mgr.track(ctx)
        old_ts = ctx.last_activity_at
        mgr.touch("s1")
        assert ctx.last_activity_at >= old_ts
