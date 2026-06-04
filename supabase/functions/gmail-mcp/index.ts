import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// MCP server that Claude connects to (via the chat function's mcp_servers).
// It's a THIN PROXY: Claude talks to us over MCP (Bearer SHARED_SECRET, which
// is all Anthropic's native MCP connector supports), and we forward tool calls
// to Composio (which needs x-api-key). Composio owns the Gmail OAuth, tokens,
// refresh, and the actual Gmail API calls — we just translate the protocol.

const SHARED_SECRET = "717fa3c352eda109dcda2451e97f1254a62c244e526eccbb";
const API_KEY = Deno.env.get("COMPOSIO_API_KEY")!;
const USER_ID = "primary";

// The Composio Gmail tools we expose. Schemas/descriptions are pulled live
// from Composio so we never hardcode (and drift from) their argument shapes.
const ALLOWED = ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "GMAIL_SEND_EMAIL"];

// Cache the converted tool list across warm invocations.
let toolCache: { name: string; description: string; inputSchema: unknown }[] | null = null;

async function listTools() {
  if (toolCache) return toolCache;
  const u = new URL("https://backend.composio.dev/api/v3.1/tools");
  u.searchParams.set("toolkit_slug", "gmail");
  u.searchParams.set("limit", "200");
  const res = await fetch(u.toString(), { headers: { "x-api-key": API_KEY } });
  if (!res.ok) throw new Error(`Composio tools ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
  const allow = new Set(ALLOWED);
  const tools = items
    .filter((t) => allow.has(t.slug))
    .map((t) => ({
      name: t.slug,
      description: t.description ?? t.name ?? t.slug,
      inputSchema: t.input_parameters ?? { type: "object", properties: {} },
    }));
  // Keep our preferred order; only cache once we actually got them.
  if (tools.length) toolCache = ALLOWED.map((s) => tools.find((t) => t.name === s)).filter(Boolean) as typeof tools;
  return toolCache ?? tools;
}

async function execTool(name: string, args: unknown): Promise<string> {
  const res = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ user_id: USER_ID, arguments: args ?? {} }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Composio execute ${res.status}: ${JSON.stringify(body)}`);
  if (body.successful === false || body.error) throw new Error(String(body.error || "Tool execution failed"));
  const data = body.data ?? body;
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return new Response("Go Farther Gmail MCP (Composio-backed)", { status: 200 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const auth = req.headers.get("authorization") || "";
  if (auth !== "Bearer " + SHARED_SECRET) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let msg: any;
  try { msg = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const id = msg.id ?? null;
  const method = msg.method;
  const J = (obj: unknown) => new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });

  if (method === "initialize") {
    return J({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gofarther-gmail", version: "2.0.0" },
      },
    });
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return new Response(null, { status: 202 });
  if (method === "tools/list") {
    try {
      return J({ jsonrpc: "2.0", id, result: { tools: await listTools() } });
    } catch (e) {
      return J({ jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  }
  if (method === "tools/call") {
    const p = msg.params || {};
    try {
      const text = await execTool(p.name, p.arguments || {});
      return J({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      return J({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "Error: " + (e instanceof Error ? e.message : String(e)) }], isError: true },
      });
    }
  }
  if (method === "ping") return J({ jsonrpc: "2.0", id, result: {} });
  return J({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
});
