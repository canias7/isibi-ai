import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Workflow builder: turn a natural-language request into a structured workflow
// GRAPH (trigger + nodes + edges) PLUS a compiled `instruction` the runner
// executes. If the request is ambiguous or missing key details, it ASKS short
// clarifying questions first (like a careful assistant) instead of guessing.
// Accepts the running conversation so answers refine the build. Uses Opus.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");
const MODEL = "claude-opus-4-8";

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost",
  "http://localhost:5173", "http://localhost:4173",
]);
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow = !origin || ALLOWED_ORIGINS.has(origin) ? (origin ?? "*") : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Caller identity from the (platform-validated) JWT.
function userFromJwt(req: Request): string | null {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

// frontend connector id <-> Composio toolkit slug
const APP_TO_SLUG: Record<string, string> = {
  gmail: "gmail", gcal: "googlecalendar", gdrive: "googledrive", canva: "canva", figma: "figma",
  notion: "notion", atlassian: "jira", m365: "outlook", slack: "slack", hubspot: "hubspot",
  googlesheets: "googlesheets", googledocs: "googledocs", excel: "excel", one_drive: "one_drive",
  dropbox: "dropbox", box: "box", onenote: "onenote", airtable: "airtable", todoist: "todoist",
  googletasks: "googletasks", asana: "asana", trello: "trello", clickup: "clickup", monday: "monday",
  miro: "miro", calendly: "calendly", zoom: "zoom", googlemeet: "googlemeet", microsoft_teams: "microsoft_teams",
  webex: "webex", telegram: "telegram", discord: "discord", linkedin: "linkedin", reddit: "reddit",
  youtube: "youtube", instagram: "instagram", twitter: "twitter", spotify: "spotify", salesforce: "salesforce",
  pipedrive: "pipedrive", zoho: "zoho", zendesk: "zendesk", intercom: "intercom", freshdesk: "freshdesk",
  shopify: "shopify", stripe: "stripe", square: "square", quickbooks: "quickbooks", xero: "xero",
  typeform: "typeform", jotform: "jotform", mailchimp: "mailchimp", sendgrid: "sendgrid", klaviyo: "klaviyo",
};
const SLUG_TO_APP: Record<string, string> = Object.fromEntries(
  Object.entries(APP_TO_SLUG).map(([a, s]) => [s, a]),
);

// Which apps has this user connected (returned as frontend connector ids)?
async function connectedApps(uid: string): Promise<string[]> {
  if (!COMPOSIO_API_KEY) return [];
  try {
    const u = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
    u.searchParams.set("user_ids", uid);
    u.searchParams.set("statuses", "ACTIVE");
    const res = await fetch(u.toString(), { headers: { "x-api-key": COMPOSIO_API_KEY } });
    if (!res.ok) return [];
    const body = await res.json();
    const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
    const ids = items
      .map((x) => x.toolkit?.slug ?? x.toolkit_slug ?? (typeof x.toolkit === "string" ? x.toolkit : null))
      .filter((s): s is string => !!s)
      .map((s) => SLUG_TO_APP[s] || s);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

// Two tools: ask clarifying questions, or emit the finished workflow.
const ASK_TOOL = {
  name: "ask",
  description: "Ask the user 1-3 SHORT, MULTIPLE-CHOICE clarifying questions when the request is ambiguous or missing a detail that would change what the workflow does, who it contacts, or which account it uses. Ask EVERYTHING you're unsure about in this single call. Prefer this over guessing on anything that matters.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "1-3 multiple-choice questions, asked together in one round.",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "One short, plain-language question." },
            header: { type: "string", description: "1-2 word category label for the question (e.g. \"Account\", \"Scope\", \"Recipient\")." },
            options: {
              type: "array",
              description: "2-4 concrete choices the user can tap. The app adds an \"Other\" choice automatically, so never include one yourself.",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Short choice text (1-4 words)." },
                  description: { type: "string", description: "Optional one-line clarification of this choice." },
                },
                required: ["label"],
              },
            },
          },
          required: ["question", "header", "options"],
        },
      },
    },
    required: ["questions"],
  },
};
const EMIT_TOOL = {
  name: "emit_workflow",
  description: "Return the structured workflow you designed.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short name for the workflow (2-5 words)." },
      instruction: {
        type: "string",
        description: "ONE clear paragraph telling the assistant exactly what to do each time this runs, naming the apps to use. This is what actually executes.",
      },
      trigger: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["schedule", "event"] },
          schedule: {
            type: "object",
            properties: {
              freq: { type: "string", enum: ["daily", "weekly", "hourly"] },
              hour: { type: "integer" },
              minute: { type: "integer" },
              weekday: { type: "integer", description: "0=Sun .. 6=Sat (weekly only)" },
            },
          },
          event: {
            type: "object",
            properties: {
              app: { type: "string", description: "connector id of the app to watch" },
              filter: { type: "string", description: "short natural-language condition" },
            },
          },
        },
        required: ["type"],
      },
      nodes: {
        type: "array",
        description: "Ordered steps. The FIRST node must be the trigger.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "stable id, e.g. n1, n2" },
            kind: { type: "string", enum: ["trigger", "action", "decision"] },
            app: { type: "string", description: "connector id, or 'schedule'/'event' (trigger), 'ai' (reasoning), 'decision' (branch)" },
            label: { type: "string", description: "2-4 word label" },
            detail: { type: "string", description: "one short sentence" },
          },
          required: ["id", "kind", "app", "label"],
        },
      },
      edges: {
        type: "array",
        description: "Flow connections between node ids. A decision node has two edges with branch 'yes' and 'no'.",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            branch: { type: "string", enum: ["yes", "no"] },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["title", "instruction", "trigger", "nodes", "edges"],
  },
};

// Top-down tree layout: BFS depth from the trigger sets the row; siblings spread
// horizontally. Gives the client sensible starting positions (the user can drag).
function layout(nodes: any[], edges: any[]): any[] {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { children.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of edges) {
    if (ids.has(e.from) && ids.has(e.to)) {
      children.get(e.from)!.push(e.to);
      indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    }
  }
  const depth = new Map<string, number>();
  const q: string[] = nodes.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  if (!q.length && nodes.length) q.push(nodes[0].id); // fallback root
  for (const id of q) depth.set(id, 0);
  for (let head = 0; head < q.length; head++) {
    const id = q[head];
    const d = depth.get(id) || 0;
    for (const c of children.get(id) || []) {
      if (!depth.has(c) || depth.get(c)! < d + 1) depth.set(c, d + 1);
      if (!q.includes(c)) q.push(c);
    }
  }
  let maxD = 0;
  for (const d of depth.values()) maxD = Math.max(maxD, d);
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, ++maxD); // orphans last
  const rows = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) || 0;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d)!.push(n.id);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const SP_Y = 140, SP_X = 160, CX = 0;
  for (const [d, row] of rows) {
    row.forEach((id, i) => {
      const n = byId.get(id)!;
      n.x = Math.round(CX + (i - (row.length - 1) / 2) * SP_X);
      n.y = d * SP_Y;
    });
  }
  return nodes;
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);
  if (!ANTHROPIC_KEY) return J({ error: "The builder isn't configured yet." }, 500);

  const uid = userFromJwt(req);
  if (!uid) return J({ error: "unauthorized" }, 401);

  // Accept either a single `description` or the running `messages` conversation
  // ([{role:'user'|'assistant', text}]). The assistant turns are prior questions.
  let tz = "UTC";
  let messages: { role: "user" | "assistant"; content: string }[] = [];
  try {
    const b = await req.json();
    if (typeof b.tz === "string" && b.tz) tz = b.tz;
    if (Array.isArray(b.messages)) {
      messages = b.messages
        .map((m: any) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.text ?? m?.content ?? "").slice(0, 2000) }))
        .filter((m: { content: string }) => m.content);
    } else if (b.description) {
      messages = [{ role: "user", content: String(b.description).slice(0, 2000) }];
    }
  } catch { /* fallthrough */ }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return J({ error: "Describe what you want the workflow to do." }, 400);
  }

  const apps = await connectedApps(uid);
  const appList = apps.length ? apps.join(", ") : "(none connected yet)";
  const askedCount = messages.filter((m) => m.role === "assistant").length;
  const system = `You design automations for the Go Farther mobile app. Turn the user's request into a workflow as a GRAPH of steps, read top-to-bottom like a flowchart. Be the kind of assistant that asks a quick question when it actually matters instead of guessing wrong — but never asks just to ask.

The user's CONNECTED apps (use ONLY these connector ids for app steps): ${appList}.

## First: build, or ask?
When you're not sure, ASK — one quick question beats building the wrong thing. Call the "ask" tool (don't guess) when ANY of these hold:
- TWO OR MORE connected apps could do a step and the user didn't say which — e.g. Gmail AND Outlook both connected and they said "email me" / "send an email": you MUST ask which account, never silently pick one.
- a key detail is missing with no safe default: who/where (recipient, which Slack channel, which list/board), WHICH items ("my emails" = all? unread? from a sender/label?), or the exact event condition,
- the workflow's CORE purpose needs an app the user has NOT connected (ask, and offer the closest connected app as an option),
- it would delete, pay, or message people at scale (confirm scope first),
- the request is too vague to act on.
Do NOT ask when:
- only ONE connected app fits the step — just use it,
- the detail has a sensible default the user can tweak later (run time, wording, layout) — pick a reasonable one; the graph is fully editable,
- a needed app is only peripheral — substitute the closest connected app or "ai" and note it in that step's detail.

## How to ask (this matters)
- Gather EVERYTHING you're unsure about and ask it in ONE round. Don't ask, get an answer, then ask again.
- Make EVERY question MULTIPLE CHOICE: give 2-4 concrete options the user can tap (the app adds an "Other" choice for anything not listed, so never add one yourself). Only a truly open detail (e.g. an exact email address) may have no options.
- Give each option a short label, plus a one-line description when it adds clarity. Give each question a 1-2 word header (e.g. "Account", "Scope").
- Keep questions short and plain — no jargon, don't restate the whole request.
- Never re-ask something already answered earlier in the conversation.
You have already asked ${askedCount} time(s); ask at most twice total, then build your best guess with emit_workflow.

## When building, call emit_workflow
- The FIRST node is the trigger: kind "trigger", app "schedule" (time-based) or "event" (fires when something new arrives in an app).
- Pure-reasoning steps (summarize, draft, decide wording) use app "ai". An if/branch is kind "decision", app "decision".
- App steps use the connector id from the connected list.
- Labels: 2-4 words. detail: one short sentence.
- edges connect node ids in execution order; a decision node has exactly two outgoing edges, branch "yes" and "no".
- trigger: if time-based, fill schedule {freq, hour 0-23, minute, weekday 0-6 when weekly} in the user's timezone (${tz}); default to a daily 8:00 AM run when unspecified. If arrival-based, fill event {app: <connector id>, filter: <short condition>}.
- instruction: one clear, self-contained paragraph the assistant follows each run, naming the apps. Make every step handle the empty case gracefully (if there's nothing to act on, do nothing or send a brief "nothing today" — never error). This is the real executable spec.`;

  const reqBody: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 3000,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    tools: [ASK_TOOL, EMIT_TOOL],
    // Hard cap: after two question rounds, force a build (stop asking).
    tool_choice: askedCount >= 2 ? { type: "tool", name: "emit_workflow" } : { type: "any" },
  };

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(reqBody),
    });
  } catch (e) {
    console.error("builder request failed:", e);
    return J({ error: "The builder is temporarily unavailable. Please try again." }, 502);
  }
  if (!res.ok) {
    console.error(`builder ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return J({ error: "The builder is temporarily unavailable. Please try again." }, 502);
  }

  const data = await res.json();
  const content = data.content || [];

  // Clarifying questions path. Each question is multiple-choice: a header, the
  // question, and tappable options ({label, description?}). The app adds "Other".
  const ask = content.find((b: any) => b?.type === "tool_use" && b?.name === "ask");
  if (ask?.input?.questions && Array.isArray(ask.input.questions)) {
    const questions = ask.input.questions
      .map((q: any) => {
        const text = String((q && typeof q === "object" ? (q.question ?? q.text) : q) ?? "").trim();
        const header = q && typeof q === "object" ? String(q.header ?? "").trim() : "";
        const options = q && typeof q === "object" && Array.isArray(q.options)
          ? q.options
              .map((o: any) => {
                if (o && typeof o === "object") {
                  const label = String(o.label ?? o.value ?? "").trim();
                  const description = String(o.description ?? "").trim();
                  return label ? (description ? { label, description } : { label }) : null;
                }
                const label = String(o ?? "").trim();
                return label ? { label } : null;
              })
              .filter(Boolean)
              .slice(0, 6)
          : [];
        const out: any = { text };
        if (header) out.header = header;
        if (options.length) out.options = options;
        return out;
      })
      .filter((q: { text: string }) => q.text)
      .slice(0, 3);
    if (questions.length) return J({ questions });
  }

  // Build path.
  const tu = content.find((b: any) => b?.type === "tool_use" && b?.name === "emit_workflow");
  if (!tu || !tu.input) return J({ error: "Couldn't draft a workflow from that — try describing it a bit more." }, 502);
  const plan = tu.input as any;

  const nodes = (Array.isArray(plan.nodes) ? plan.nodes : []).map((n: any, i: number) => ({
    id: String(n?.id || `n${i + 1}`),
    kind: ["trigger", "action", "decision"].includes(n?.kind) ? n.kind : "action",
    app: String(n?.app || "ai"),
    label: String(n?.label || "Step").slice(0, 40),
    detail: String(n?.detail || "").slice(0, 200),
  }));
  const edges = (Array.isArray(plan.edges) ? plan.edges : [])
    .map((e: any) => ({ from: String(e?.from || ""), to: String(e?.to || ""), branch: e?.branch === "yes" || e?.branch === "no" ? e.branch : null }))
    .filter((e: any) => e.from && e.to);

  const trigger = (plan.trigger && typeof plan.trigger === "object") ? plan.trigger : { type: "schedule" };
  if (trigger.type === "schedule") {
    trigger.schedule = { freq: "daily", hour: 8, minute: 0, weekday: 1, ...(trigger.schedule || {}), tz };
  } else if (trigger.type === "event") {
    // An event trigger must watch a real, connected app or it would never fire
    // (silently). Fall back to the first connected app, else to a daily schedule.
    const ev = (trigger.event && typeof trigger.event === "object") ? trigger.event : {};
    let app = String(ev.app || "");
    if (!APP_TO_SLUG[app] || !apps.includes(app)) app = apps[0] || "";
    if (app) trigger.event = { app, filter: String(ev.filter || "") };
    else { trigger.type = "schedule"; trigger.schedule = { freq: "daily", hour: 8, minute: 0, weekday: 1, tz }; }
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const out = {
    title: String(plan.title || lastUser.slice(0, 40)),
    instruction: String(plan.instruction || lastUser),
    trigger,
    graph: { nodes: layout(nodes, edges), edges },
  };
  return J(out);
});
