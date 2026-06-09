"""Allow ``python -m deepagents_app_py`` to invoke the CLI."""
from __future__ import annotations

import sys

from deepagents_app_py.main import main

if __name__ == "__main__":
    sys.exit(main())
