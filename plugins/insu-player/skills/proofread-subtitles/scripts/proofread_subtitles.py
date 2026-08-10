#!/usr/bin/env python3
"""Same-language entrypoint for the shared subtitle revision core."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


CORE = Path(__file__).resolve().parents[2] / "translate-subtitles" / "scripts" / "reflow_subtitles.py"


def proofread_arguments(arguments: list[str]) -> list[str]:
    if not arguments or arguments[0] != "prepare":
        return arguments
    rewritten = list(arguments)
    if "--mode" not in rewritten:
        rewritten.extend(["--mode", "proofread"])
    if "--language" in rewritten:
        index = rewritten.index("--language")
        try:
            language = rewritten[index + 1]
        except IndexError as error:
            raise SystemExit("error: --language requires a BCP 47 value") from error
        del rewritten[index : index + 2]
        if "--source-language" not in rewritten:
            rewritten.extend(["--source-language", language])
        if "--output-language" not in rewritten:
            rewritten.extend(["--output-language", language])
    return rewritten


if __name__ == "__main__":
    if not CORE.is_file():
        raise SystemExit(f"error: shared subtitle revision core is missing: {CORE}")
    sys.argv = [str(CORE), *proofread_arguments(sys.argv[1:])]
    runpy.run_path(str(CORE), run_name="__main__")
