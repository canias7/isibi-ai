"""Reference: serve-time tool scoping for the runner (see ../BACKEND_WIRING.md §2).

At run time, `run-workflows` must hand `gf-runner` a BOUNDED tool menu — a local
model can't search thousands of connector tools the way Claude's
`tool_search_tool_regex` does. Given the workflow's connected apps + the
instruction, rank the candidate tools by relevance and keep the top `GF_TOOL_CAP`
— matching the menu size the runner was *trained* on (runner_gen.select_tools).

This is the deterministic crux of the runner wiring; port it to TS in run-workflows.
The ranker here is a transparent keyword baseline — swap in embeddings later if you
want; the plumbing (apps -> candidates -> rank -> cap) is the reusable part.

    python scope_tools.py   # offline self-test
"""
from __future__ import annotations

import os
import re

from catalog import ALLOWED, BUILTINS, frontend_id, tools_for

CAP = int(os.environ.get("GF_TOOL_CAP", "16"))   # keep in lock-step with runner_gen.TOOL_CAP
_WORD = re.compile(r"[a-z0-9]+")
# Built-ins worth keeping available even without a keyword hit (cheap, always-on).
_CORE_BUILTINS = [b for b in ("GF_SET_REMINDER", "GF_WEATHER", "GF_MAPS", "GF_SAVE_MEMORY") if b in BUILTINS]


def _tokens(s: str) -> set[str]:
    return set(_WORD.findall(s.lower()))


def candidates(connected: list[str]) -> list[str]:
    """Every tool reachable from this workflow's apps + the built-ins (deduped)."""
    names: list[str] = []
    for fid in connected:
        slug = next((s for s in ALLOWED if frontend_id(s) == fid), fid)
        names.extend(tools_for(slug))
    names.extend(BUILTINS.keys())
    return list(dict.fromkeys(names))


def _score(tool: str, want: set[str]) -> int:
    """Name overlaps weigh double description overlaps (GMAIL_SEND_EMAIL vs prose)."""
    return 2 * len(_tokens(tool) & want) + len(_tokens(BUILTINS.get(tool, "")) & want)


def scope_tools(connected: list[str], instruction: str, cap: int = CAP) -> list[str]:
    """Top-`cap` tools for the apps in this workflow, ranked by relevance to the
    instruction (stable: ties keep original order). A few core built-ins are always
    retained so 'remind me / weather' style asks aren't starved by a big connector."""
    want = _tokens(instruction)
    cands = candidates(connected)
    ranked = sorted(cands, key=lambda t: _score(t, want), reverse=True)
    # top-`cap` by relevance, PLUS the core built-ins (additive — never truncated off)
    return list(dict.fromkeys([*ranked[:cap], *(b for b in _CORE_BUILTINS if b in cands)]))


def _selftest() -> None:
    # 1. a clear "send email" ask surfaces the gmail send tool into the menu
    menu = scope_tools(["gmail", "slack"], "Every morning send me an email summary of unread mail")
    assert len(menu) <= CAP + len(_CORE_BUILTINS), len(menu)
    assert any("SEND" in t and "EMAIL" in t for t in menu), f"no send-email tool: {menu[:6]}"

    # 2. a weather ask surfaces the weather built-in
    menu = scope_tools(["gmail"], "Check tomorrow's weather and email me if it'll rain")
    assert any("WEATHER" in t for t in menu), f"no weather tool: {menu[:6]}"

    # 3. bounded even with many apps and a vague instruction
    big = ["gmail", "slack", "notion", "googlecalendar", "hubspot"]
    menu = scope_tools(big, "do the thing")
    assert len(menu) <= CAP + len(_CORE_BUILTINS), len(menu)
    assert set(_CORE_BUILTINS) <= set(menu), "core built-ins dropped"

    # 4. relevance actually ranks: a calendar ask floats calendar tools above unrelated ones
    menu = scope_tools(["googlecalendar", "gmail"], "Create a calendar event for the meeting")
    assert any("CALENDAR" in t or "EVENT" in t for t in menu[:CAP]), f"calendar tool not surfaced: {menu[:6]}"

    print("scope_tools selftest passed")


if __name__ == "__main__":
    _selftest()
