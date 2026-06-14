"""Score a served RUNNER model against the held-out runner val traces (phase 2).

Phase-1 `eval.py` asked the easy question — "does the emitted JSON validate?".
The runner is a multi-turn tool-use loop, so quality is "did it call the right
tools, in a sensible order, and finish?". We measure that with a TEACHER-FORCED
rollout: start from (system, instruction), and at each turn ask the served model
which tool it calls — then feed back the GOLD result for that step (from the val
trace) and continue. Teacher-forcing the *results* isolates the model's decision
quality from its result-handling, and keeps every rollout aligned to the gold
trace so the sequences are comparable.

Metrics (RUNNER.md options 1 + 2):
  structural : every called tool is real/available, 1-5 calls, ends with a final
  tool-set   : model used exactly the gold SET of tools (order-free)
  trajectory : model's ORDERED tool sequence == gold's
  first-tool : model's first tool == gold's first tool
  finished   : model emitted a final step (didn't loop to the cap)

Usage:
    python runner_eval.py --selftest                 # offline metric-logic check
    # fine-tuned runner via Ollama:
    python runner_eval.py --base-url http://localhost:11434/v1 --model gf-runner
    # baseline (stock Qwen) for comparison:
    python runner_eval.py --base-url http://localhost:11434/v1 --model qwen2.5:7b-instruct
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent

# Cap a rollout so a model that never emits a final can't loop forever. Traces
# are 1-5 tool steps (runner_gen.valid_trace), so 6 turns is always enough.
MAX_STEPS = 6


def parse_gold(row: dict[str, Any]) -> dict[str, Any]:
    """Pull the eval inputs + gold trajectory out of one runner_data row.

    Row shape (from runner_gen.to_chat): {messages, tools} where messages =
    [system, user, assistant(tool_calls), tool(result), ..., assistant(final)].
    """
    msgs = row["messages"]
    system = next((m["content"] for m in msgs if m["role"] == "system"), "")
    user = next((m["content"] for m in msgs if m["role"] == "user"), "")
    tools = row.get("tools", [])
    allowed = {t["function"]["name"] for t in tools if t.get("function")}

    gold_calls: list[str] = []      # tool names, in order
    gold_results: list[str] = []    # the tool result that followed each call
    gold_finished = False
    for m in msgs:
        if m["role"] == "assistant" and m.get("tool_calls"):
            gold_calls.append(m["tool_calls"][0]["function"]["name"])
        elif m["role"] == "tool":
            gold_results.append(str(m.get("content", "")))
        elif m["role"] == "assistant" and not m.get("tool_calls"):
            gold_finished = True    # an assistant turn with no tool_calls = the final
    return {"system": system, "user": user, "tools": tools, "allowed": allowed,
            "gold_calls": gold_calls, "gold_results": gold_results, "gold_finished": gold_finished}


def rollout(client, model: str, g: dict[str, Any]) -> tuple[list[str], bool]:
    """Teacher-forced rollout: model picks each tool; we feed back the GOLD result.

    Returns (predicted tool names in order, finished?). `finished` means the model
    chose to stop (emitted a turn with no tool call) within MAX_STEPS.
    """
    msgs: list[dict[str, Any]] = [
        {"role": "system", "content": g["system"]},
        {"role": "user", "content": g["user"]},
    ]
    pred: list[str] = []
    for i in range(MAX_STEPS):
        resp = client.chat.completions.create(
            model=model, messages=msgs, tools=g["tools"] or None,
            max_tokens=1024, temperature=0,
        )
        m = resp.choices[0].message
        calls = m.tool_calls or []
        if not calls:
            return pred, True              # final turn — model decided it's done
        tc = calls[0]
        pred.append(tc.function.name)
        msgs.append({"role": "assistant", "content": m.content or "", "tool_calls": [
            {"id": tc.id, "type": "function",
             "function": {"name": tc.function.name, "arguments": tc.function.arguments}}]})
        # teacher-force: replay the gold result for this step (fall back to a
        # neutral "ok" if the model ran longer than the gold trace did).
        gold_res = g["gold_results"][i] if i < len(g["gold_results"]) else "ok"
        msgs.append({"role": "tool", "tool_call_id": tc.id, "content": gold_res})
    return pred, False                      # hit the cap without finishing


def score(pred: list[str], finished: bool, g: dict[str, Any]) -> dict[str, bool]:
    """Compare a predicted trajectory against the gold one (pure; no I/O)."""
    gold = g["gold_calls"]
    allowed = g["allowed"]
    structural = (
        bool(pred)
        and all(t in allowed for t in pred)
        and 1 <= len(pred) <= 5
        and finished
    )
    return {
        "structural": structural,
        "tool_set": set(pred) == set(gold),
        "trajectory": pred == gold,
        "first_tool": pred[:1] == gold[:1],
        "finished": finished,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:11434/v1")
    ap.add_argument("--model", default="gf-runner")
    ap.add_argument("--api-key", default="ollama")
    ap.add_argument("--file", default=str(HERE / "runner_data" / "val.jsonl"))
    ap.add_argument("--selftest", action="store_true", help="offline metric-logic check (no API)")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return

    from openai import OpenAI  # imported lazily so --selftest needs no deps
    client = OpenAI(base_url=args.base_url, api_key=args.api_key)
    path = Path(args.file)
    if not path.exists():
        print(f"no val traces at {path} — run runner_gen.py first")
        return
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    n = len(rows)
    agg = {"structural": 0, "tool_set": 0, "trajectory": 0, "first_tool": 0, "finished": 0}
    for i, row in enumerate(rows, 1):
        g = parse_gold(row)
        try:
            pred, finished = rollout(client, args.model, g)
        except Exception as e:  # noqa: BLE001 — one bad row shouldn't abort the run
            print(f"[{i}/{n}] rollout error: {str(e)[:80]}")
            continue
        s = score(pred, finished, g)
        for k in agg:
            agg[k] += s[k]
        tag = "ok" if s["trajectory"] else ("set" if s["tool_set"] else "miss")
        print(f"[{i}/{n}] {tag:4} pred={pred} gold={g['gold_calls']}")

    print("\n--- results ---")
    for k in ("structural", "first_tool", "tool_set", "trajectory", "finished"):
        print(f"{k:11}: {agg[k]}/{n}  ({100 * agg[k] // max(n, 1)}%)")


def selftest() -> None:
    """Offline: prove gold extraction + the metric logic without a served model."""
    row = {
        "tools": [
            {"type": "function", "function": {"name": "GMAIL_FETCH_EMAILS"}},
            {"type": "function", "function": {"name": "SLACK_SEND_MESSAGE"}},
        ],
        "messages": [
            {"role": "system", "content": "runner sys"},
            {"role": "user", "content": "Post my unread Gmail count to Slack"},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "GMAIL_FETCH_EMAILS", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "3 unread"},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "c2", "type": "function", "function": {"name": "SLACK_SEND_MESSAGE", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "c2", "content": "sent"},
            {"role": "assistant", "content": "Posted your 3 unread emails to Slack."},
        ],
    }
    g = parse_gold(row)
    assert g["gold_calls"] == ["GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"], g["gold_calls"]
    assert g["gold_results"] == ["3 unread", "sent"], g["gold_results"]
    assert g["gold_finished"] is True
    assert g["allowed"] == {"GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"}

    # perfect trajectory
    s = score(["GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"], True, g)
    assert all(s.values()), s
    # right tools, wrong order -> set matches, trajectory doesn't
    s = score(["SLACK_SEND_MESSAGE", "GMAIL_FETCH_EMAILS"], True, g)
    assert s["tool_set"] and not s["trajectory"] and not s["first_tool"], s
    # a phantom tool fails structural
    s = score(["FAKE_TOOL"], True, g)
    assert not s["structural"] and not s["tool_set"], s
    # never finished -> structural fails even if the calls were right
    s = score(["GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"], False, g)
    assert s["trajectory"] and not s["structural"] and not s["finished"], s
    # too many calls fails structural
    s = score(["GMAIL_FETCH_EMAILS"] * 6, True, g)
    assert not s["structural"], s
    print("runner_eval selftest passed")


if __name__ == "__main__":
    main()
