// Self-test for finalize.ts — proves the repair pass on adversarial fixtures.
// Run (logic check; this file is NOT imported by index.ts, so it never ships):
//   node --experimental-strip-types finalize.selftest.ts
// Mirrors finetune/finalize.py's _selftest so the TS port stays behaviourally
// identical to the Python that's unit-tested against the real validator.
import { finalize } from "./finalize.ts";

const BUILTINS = new Set([
  "GF_BANK_AUTH","GF_BANK_BALANCES","GF_BANK_IDENTITY","GF_BANK_INSIGHTS",
  "GF_BANK_INVESTMENTS","GF_BANK_INVESTMENT_TRANSACTIONS","GF_BANK_LIABILITIES",
  "GF_BANK_RECURRING","GF_BANK_TRANSACTIONS","GF_GET_MEMORY_FILE","GF_IMAGE",
  "GF_MAPS","GF_SAVE_MEMORY","GF_SAVE_TABLE","GF_SET_REMINDER","GF_WEATHER",
]);
const TOK = /[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+/g;

function noPhantoms(wf: any): boolean {
  const texts = [wf.instruction ?? ""];
  for (const n of wf.nodes) texts.push(String(n.detail ?? ""), String(n.label ?? ""));
  for (const t of texts)
    for (const m of String(t).match(TOK) ?? [])
      if (!BUILTINS.has(m)) return false;
  return true;
}
function base(): any {
  return {
    title: "Morning Email", instruction: "Each morning send a summary.",
    trigger: { type: "schedule", schedule: { freq: "daily", hour: 8, minute: 0 } },
    nodes: [
      { id: "n1", kind: "trigger", app: "schedule", label: "Daily", detail: "8am" },
      { id: "n2", kind: "action", app: "gmail", label: "Email", detail: "send it" },
    ],
    edges: [{ from: "n1", to: "n2" }],
  };
}
let pass = 0;
function ok(name: string, cond: boolean) {
  if (!cond) { console.error("  FAIL", name); (globalThis as any).process && ((globalThis as any).process.exitCode = 1); }
  else { console.log("  ok  ", name); pass++; }
}
const ids = (w: any) => new Set(w.nodes.map((n: any) => n.id));

let w = base(); w.nodes[1].detail = "send it via GMAIL_TOTALLY_FAKE_TOOL";
finalize(w); ok("phantom connector token", noPhantoms(w));

w = base(); w.instruction = "Summarize and post via SLACK_INVENTED_POSTER now.";
finalize(w); ok("phantom in instruction", noPhantoms(w));

w = base(); w.trigger.schedule.hour = 27; w.trigger.schedule.minute = 90;
finalize(w); ok("out-of-range hour/minute",
  w.trigger.schedule.hour <= 23 && w.trigger.schedule.minute <= 59);

w = base(); w.edges.push({ from: "n2", to: "n99" });
finalize(w); ok("orphan edge", w.edges.every((e: any) => ids(w).has(e.from) && ids(w).has(e.to)));

w = base(); w.nodes[1].id = "n1"; w.edges = [{ from: "n1", to: "n1" }];
finalize(w); ok("duplicate ids", ids(w).size === w.nodes.length);

w = base(); w.nodes.reverse();
finalize(w); ok("first node not trigger", w.nodes[0].kind === "trigger");

w = base();
w.nodes.splice(1, 0, { id: "d1", kind: "decision", app: "decision", label: "Check?" });
w.edges = [{ from: "n1", to: "d1" }, { from: "d1", to: "n2" }];
finalize(w); ok("broken decision demoted",
  w.nodes.every((n: any) => n.id !== "d1" || n.kind !== "decision"));

w = base(); w.title = "  "; w.nodes[1].label = "";
finalize(w); ok("empty title/label",
  w.title.trim() !== "" && w.nodes.every((n: any) => String(n.label).trim() !== ""));

// NO-HARM: a valid decision workflow is left structurally intact
w = {
  title: "Morning Inbox Digest", instruction: "Each morning fetch unread Gmail; if none email a note, else send a digest.",
  trigger: { type: "schedule", schedule: { freq: "daily", hour: 8, minute: 0 } },
  nodes: [
    { id: "n1", kind: "trigger", app: "schedule", label: "Daily 8 AM", detail: "Runs each morning" },
    { id: "n2", kind: "action", app: "gmail", label: "Get unread", detail: "Unread from last 24h" },
    { id: "n3", kind: "decision", app: "decision", label: "Any unread?", detail: "Branch on new mail" },
    { id: "n4", kind: "action", app: "ai", label: "Summarize", detail: "Group by sender" },
    { id: "n5", kind: "action", app: "gmail", label: "Email digest", detail: "Send the summary" },
    { id: "n6", kind: "action", app: "gmail", label: "Email none", detail: "Send no-mail note" },
  ],
  edges: [
    { from: "n1", to: "n2" }, { from: "n2", to: "n3" },
    { from: "n3", to: "n4", branch: "yes" }, { from: "n3", to: "n6", branch: "no" },
    { from: "n4", to: "n5" },
  ],
};
const beforeKinds = w.nodes.map((n: any) => n.kind).join(",");
const beforeInstr = w.instruction;
finalize(w);
ok("valid workflow unchanged (decision kept, instruction intact)",
  w.nodes.length === 6 && w.nodes.map((n: any) => n.kind).join(",") === beforeKinds
  && w.instruction === beforeInstr);

// The 4 EXACT screenshot tokens -> all stripped, real GF_IMAGE survives
w = {
  title: "Sync Calendars",
  instruction: "List calendars via OUTLOOK_LIST_CALENDARS and AIRTABLE_LIST_BASE_SCHEMA, archive with GF_DOCS.",
  trigger: { type: "schedule", schedule: { freq: "daily", hour: 8, minute: 0 } },
  nodes: [
    { id: "n1", kind: "trigger", app: "schedule", label: "Daily", detail: "Runs each morning" },
    { id: "n2", kind: "action", app: "ai", label: "Save image", detail: "grab via GF_DOWNLOAD_IMAGE then GF_IMAGE" },
  ],
  edges: [{ from: "n1", to: "n2" }],
};
finalize(w);
ok("4 screenshot phantoms stripped", noPhantoms(w));
ok("real built-in GF_IMAGE preserved", /GF_IMAGE/.test(w.nodes[1].detail));

console.log(`\nfinalize.ts self-test: ${pass}/11 checks passed`);
