"""Bundle smoke tests."""

from __future__ import annotations

from importlib.metadata import version


def test_package_import():
    v = version("deepagents-app-py")
    assert v is not None
    assert isinstance(v, str)
