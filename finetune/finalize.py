"""Deterministic finalize pass: make any builder output schema-valid by construction.

Reference implementation of the repair layer in ../BACKEND_WIRING.md. The
production version lives in supabase/functions/build-workflow (TypeScript); this
mirrors it in Python so the logic is tested against the *real* validator
(schema.validate_workflow) before it's ported — port `repair_workflow` verbatim.

    finalize(wf) = clamp_schedule -> strip_phantoms -> repair_workflow

After finalize, validate_workflow(wf) is guaranteed to pass:
    structure / enums / types ...... grammar (upstream, not here)
    hour/minute/weekday ranges ..... clamp_schedule
    phantom tool tokens ............ strip_phantoms
    ids / first-trigger / labels /
      edges / decisions / title .... repair_workflow

Run `python finalize.py` for the adversarial + no-harm self-test.
"""
from __future__ import annotations

import re
from typing import Any

from schema import EXAMPLE, phantom_tools, validate_workflow

# Optional preceding filler so "send it via GMAIL_FAKE" -> "send it" (not "send it via").
_FILLER = r"(?:\b(?:via|using|with|through|by|calling)\b\s*)?"


def _tidy(text: str) -> str:
    text = re.sub(r"\s+([.,;:!?])", r"\1", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def _strip_text(text: str) -> str:
    """Remove the tool-shaped tokens the validator flags as phantom (keeps real tools)."""
    for tok in phantom_tools(text):
        text = re.sub(_FILLER + re.escape(tok), "", text)
    return _tidy(text)


def strip_phantoms(wf: dict[str, Any]) -> None:
    if isinstance(wf.get("instruction"), str):
        wf["instruction"] = _strip_text(wf["instruction"])
    for n in wf.get("nodes") or []:
        if isinstance(n, dict):
            if isinstance(n.get("detail"), str):
                n["detail"] = _strip_text(n["detail"])[:200]
            if isinstance(n.get("label"), str):
                n["label"] = _strip_text(n["label"])


def _clampi(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def clamp_schedule(wf: dict[str, Any]) -> None:
    """Grammar locks the *type* to integer but can't enforce a range — clamp here."""
    trig = wf.get("trigger")
    if not isinstance(trig, dict) or trig.get("type") != "schedule":
        return
    sch = trig.get("schedule")
    if not isinstance(sch, dict):
        return
    sch["hour"] = _clampi(sch.get("hour"), 0, 23, 9)
    sch["minute"] = _clampi(sch.get("minute"), 0, 59, 0)
    if sch.get("freq") == "weekly":
        sch["weekday"] = _clampi(sch.get("weekday"), 0, 6, 1)


def repair_workflow(wf: dict[str, Any]) -> None:
    """Fix the structural rules the grammar can't: ids, first-trigger, labels,
    edge cross-refs, decision branches, non-empty title/instruction."""
    nodes = wf.get("nodes")
    if not isinstance(nodes, list):
        nodes = wf["nodes"] = []

    # 1. node ids: non-empty + unique (no remap — a renamed dupe just orphans, which is valid)
    seen: set[str] = set()
    for i, n in enumerate(nodes):
        if not isinstance(n, dict):
            continue
        nid = n.get("id")
        if not (isinstance(nid, str) and nid.strip()) or nid in seen:
            nid = f"n{i + 1}"
            while nid in seen:
                nid += "_"
        seen.add(nid)
        n["id"] = nid

    # 2. first node must be the trigger
    ti = next((i for i, n in enumerate(nodes)
               if isinstance(n, dict) and n.get("kind") == "trigger"), -1)
    if ti > 0:
        nodes.insert(0, nodes.pop(ti))
    elif ti == -1 and nodes and isinstance(nodes[0], dict):
        nodes[0]["kind"] = "trigger"

    # 3. labels: non-empty fallback
    for n in nodes:
        if isinstance(n, dict) and not str(n.get("label") or "").strip():
            n["label"] = " ".join(str(n.get("detail") or "").split()[:3]) or "Step"

    # 4. edges: drop orphans (from/to not a real node) + self-loops
    ids = {n["id"] for n in nodes if isinstance(n, dict)}
    edges = [dict(e) for e in (wf.get("edges") or []) if isinstance(e, dict)]
    edges = [e for e in edges
             if e.get("from") in ids and e.get("to") in ids and e.get("from") != e.get("to")]
    wf["edges"] = edges

    # 5. decision nodes: need yes+no to DIFFERENT nodes, else demote to a plain action
    for n in nodes:
        if not isinstance(n, dict) or n.get("kind") != "decision":
            continue
        outs = [e for e in edges if e.get("from") == n["id"]]
        yes = next((e.get("to") for e in outs if e.get("branch") == "yes"), None)
        no = next((e.get("to") for e in outs if e.get("branch") == "no"), None)
        if not yes or not no or yes == no:
            n["kind"] = "action"
            for e in outs:
                e.pop("branch", None)

    # 6. title / instruction non-empty fallback
    if not str(wf.get("title") or "").strip():
        wf["title"] = " ".join(str(wf.get("instruction") or "").split()[:4]) or "Workflow"
    if not str(wf.get("instruction") or "").strip():
        wf["instruction"] = "Run the requested automation."


def finalize(wf: dict[str, Any]) -> dict[str, Any]:
    clamp_schedule(wf)
    strip_phantoms(wf)
    repair_workflow(wf)
    return wf


# --------------------------------------------------------------------------- #
# Self-test: every adversarial input ends valid; a valid input is left intact.
# --------------------------------------------------------------------------- #
def _selftest() -> None:
    import copy

    def _base() -> dict[str, Any]:
        return {
            "title": "Morning Email", "instruction": "Each morning send a summary.",
            "trigger": {"type": "schedule", "schedule": {"freq": "daily", "hour": 8, "minute": 0}},
            "nodes": [
                {"id": "n1", "kind": "trigger", "app": "schedule", "label": "Daily", "detail": "8am"},
                {"id": "n2", "kind": "action", "app": "gmail", "label": "Email", "detail": "send it"},
            ],
            "edges": [{"from": "n1", "to": "n2"}],
        }

    def _no_phantoms(w: dict[str, Any]) -> bool:
        texts = [w.get("instruction", "")]
        for n in w["nodes"]:
            texts += [str(n.get("detail", "")), str(n.get("label", ""))]
        return not any(phantom_tools(t) for t in texts)

    def run(name: str, wf: dict[str, Any], check=None) -> None:
        wf = copy.deepcopy(wf)
        finalize(wf)
        ok, errs = validate_workflow(wf)
        assert ok, f"{name}: STILL INVALID -> {errs}"
        if check is not None:
            check(wf)
        print(f"  ok  {name}")

    # A. phantom connector token in a detail -> stripped
    wf = _base(); wf["nodes"][1]["detail"] = "send it via GMAIL_TOTALLY_FAKE_TOOL"
    run("phantom connector token", wf, lambda w: assert_(_no_phantoms(w), "phantom remained"))

    # B. phantom token in the instruction -> stripped
    wf = _base(); wf["instruction"] = "Summarize and post via SLACK_INVENTED_POSTER now."
    run("phantom in instruction", wf, lambda w: assert_(_no_phantoms(w), "phantom remained"))

    # C. out-of-range schedule -> clamped
    wf = _base(); wf["trigger"]["schedule"].update(hour=27, minute=90)
    run("out-of-range hour/minute", wf,
        lambda w: assert_(w["trigger"]["schedule"]["hour"] <= 23
                          and w["trigger"]["schedule"]["minute"] <= 59, "not clamped"))

    # D. edge to a non-existent node -> dropped
    wf = _base(); wf["edges"].append({"from": "n2", "to": "n99"})
    run("orphan edge", wf, lambda w: assert_(all(
        e["from"] in {n["id"] for n in w["nodes"]} and e["to"] in {n["id"] for n in w["nodes"]}
        for e in w["edges"]), "orphan edge survived"))

    # E. duplicate node ids -> uniquified
    wf = _base(); wf["nodes"][1]["id"] = "n1"; wf["edges"] = [{"from": "n1", "to": "n1"}]
    run("duplicate ids", wf, lambda w: assert_(
        len({n["id"] for n in w["nodes"]}) == len(w["nodes"]), "ids not unique"))

    # F. first node isn't the trigger -> reordered
    wf = _base(); wf["nodes"] = list(reversed(wf["nodes"]))
    run("first node not trigger", wf, lambda w: assert_(w["nodes"][0]["kind"] == "trigger", "trigger not first"))

    # G. malformed decision (no yes/no) -> demoted to action
    wf = _base()
    wf["nodes"].insert(1, {"id": "d1", "kind": "decision", "app": "decision", "label": "Check?"})
    wf["edges"] = [{"from": "n1", "to": "d1"}, {"from": "d1", "to": "n2"}]
    run("broken decision demoted", wf, lambda w: assert_(
        all(n["kind"] != "decision" for n in w["nodes"] if n["id"] == "d1"), "decision not demoted"))

    # H. empty title + empty label -> filled
    wf = _base(); wf["title"] = "  "; wf["nodes"][1]["label"] = ""
    run("empty title/label", wf, lambda w: assert_(
        w["title"].strip() and all(n["label"].strip() for n in w["nodes"]), "blank field"))

    # I. NO-HARM: a fully valid workflow (the canonical EXAMPLE) passes unchanged
    before = copy.deepcopy(EXAMPLE)
    after = finalize(copy.deepcopy(EXAMPLE))
    ok, errs = validate_workflow(after)
    assert ok, f"EXAMPLE invalid after finalize -> {errs}"
    assert len(after["nodes"]) == len(before["nodes"]), "EXAMPLE node count changed"
    assert [n["kind"] for n in after["nodes"]] == [n["kind"] for n in before["nodes"]], \
        "EXAMPLE node kinds changed (a valid decision got demoted!)"
    assert after["instruction"] == before["instruction"], "EXAMPLE instruction was altered"
    print("  ok  valid EXAMPLE unchanged (no false repairs)")

    print("finalize self-test passed")


def assert_(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


if __name__ == "__main__":
    _selftest()
