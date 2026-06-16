// finalize.ts — deterministic repair pass that makes any builder output
// schema-valid by construction. Reference port of finetune/finalize.py (which is
// unit-tested against the real Python validator). Mirrors the same three steps:
//
//     finalize(wf) = clampSchedule -> stripPhantoms -> repairWorkflow
//
// HOW TO WIRE: import { finalize } and call it on the parsed workflow AFTER the
// model (+ any self-correct retry) and BEFORE save/return, then re-run the
// existing validator and log if it ever still fails. Deploy from the machine that
// owns prod — prod is ahead of git, so do NOT blind-deploy this repo.
//
// PHANTOM STRIP: build-workflow doesn't ship the full 5,847-tool catalog, so we
// keep only the real GF_ built-ins (the tokens 'ai' nodes legitimately name) and
// strip every other tool-shaped token from prose. That is lossless — nothing
// parses tool names from prose, and run-workflows discovers the real connector
// tool at runtime. It also covers catalog drift: a real-but-unknown connector
// token (e.g. OUTLOOK_LIST_CALENDARS) is simply stripped, never flagged.

type Json = Record<string, any>;

// The ONLY tool-shaped tokens allowed to survive in prose: the 'ai' built-ins
// (catalog GF_* tools). Keep in sync with build-workflow's built-in list.
const BUILTINS = new Set<string>([
  "GF_BANK_AUTH", "GF_BANK_BALANCES", "GF_BANK_IDENTITY", "GF_BANK_INSIGHTS",
  "GF_BANK_INVESTMENTS", "GF_BANK_INVESTMENT_TRANSACTIONS", "GF_BANK_LIABILITIES",
  "GF_BANK_RECURRING", "GF_BANK_TRANSACTIONS", "GF_GET_MEMORY_FILE", "GF_IMAGE",
  "GF_MAPS", "GF_SAVE_MEMORY", "GF_SAVE_TABLE", "GF_SET_REMINDER", "GF_WEATHER",
]);

// A tool-shaped token: ALL-CAPS with at least one underscore (GMAIL_SEND_EMAIL).
const TOOLISH = /[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+/; // non-global: safe for .exec()
// Same token with optional preceding filler so "send it via GMAIL_X" -> "send it".
const STRIP_RE =
  /(?:\s*\b(?:via|using|with|through|by|calling)\b)?\s*\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g;

function tidy(text: string): string {
  return text.replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

function stripText(text: string): string {
  const out = text.replace(STRIP_RE, (m) => {
    const tok = TOOLISH.exec(m)?.[0];
    return tok && BUILTINS.has(tok) ? m : "";
  });
  return tidy(out);
}

function stripPhantoms(wf: Json): void {
  if (typeof wf.instruction === "string") wf.instruction = stripText(wf.instruction);
  for (const n of wf.nodes ?? []) {
    if (n && typeof n === "object") {
      if (typeof n.detail === "string") n.detail = stripText(n.detail).slice(0, 200);
      if (typeof n.label === "string") n.label = stripText(n.label);
    }
  }
}

function clampInt(v: any, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? Math.trunc(v) : parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function clampSchedule(wf: Json): void {
  const trig = wf.trigger;
  if (!trig || typeof trig !== "object" || trig.type !== "schedule") return;
  const sch = trig.schedule;
  if (!sch || typeof sch !== "object") return;
  sch.hour = clampInt(sch.hour, 0, 23, 9);
  sch.minute = clampInt(sch.minute, 0, 59, 0);
  if (sch.freq === "weekly") sch.weekday = clampInt(sch.weekday, 0, 6, 1);
}

function repairWorkflow(wf: Json): void {
  let nodes = wf.nodes;
  if (!Array.isArray(nodes)) nodes = wf.nodes = [];

  // 1. node ids: non-empty + unique
  const seen = new Set<string>();
  nodes.forEach((n: Json, i: number) => {
    if (!n || typeof n !== "object") return;
    let nid = n.id;
    if (!(typeof nid === "string" && nid.trim()) || seen.has(nid)) {
      nid = `n${i + 1}`;
      while (seen.has(nid)) nid += "_";
    }
    seen.add(nid);
    n.id = nid;
  });

  // 2. first node must be the trigger
  const ti = nodes.findIndex(
    (n: Json) => n && typeof n === "object" && n.kind === "trigger",
  );
  if (ti > 0) {
    nodes.unshift(nodes.splice(ti, 1)[0]);
  } else if (ti === -1 && nodes.length && nodes[0] && typeof nodes[0] === "object") {
    nodes[0].kind = "trigger";
  }

  // 3. labels: non-empty fallback
  for (const n of nodes) {
    if (n && typeof n === "object" && !String(n.label ?? "").trim()) {
      n.label =
        String(n.detail ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(" ") ||
        "Step";
    }
  }

  // 4. edges: drop orphans (from/to not a real node) + self-loops
  const ids = new Set(
    nodes.filter((n: Json) => n && typeof n === "object").map((n: Json) => n.id),
  );
  const edges = (Array.isArray(wf.edges) ? wf.edges : [])
    .filter((e: any) => e && typeof e === "object")
    .map((e: Json) => ({ ...e }))
    .filter((e: Json) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  wf.edges = edges;

  // 5. decision nodes: need yes+no to DIFFERENT nodes, else demote to action
  for (const n of nodes) {
    if (!n || typeof n !== "object" || n.kind !== "decision") continue;
    const outs = edges.filter((e: Json) => e.from === n.id);
    const yes = outs.find((e: Json) => e.branch === "yes")?.to ?? null;
    const no = outs.find((e: Json) => e.branch === "no")?.to ?? null;
    if (!yes || !no || yes === no) {
      n.kind = "action";
      for (const e of outs) delete e.branch;
    }
  }

  // 6. title / instruction non-empty fallback
  if (!String(wf.title ?? "").trim()) {
    wf.title =
      String(wf.instruction ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(" ") ||
      "Workflow";
  }
  if (!String(wf.instruction ?? "").trim()) {
    wf.instruction = "Run the requested automation.";
  }
}

export function finalize(wf: Json): Json {
  clampSchedule(wf);
  stripPhantoms(wf);
  repairWorkflow(wf);
  return wf;
}
