import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SHARED_SECRET = "717fa3c352eda109dcda2451e97f1254a62c244e526eccbb";
const MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-mcp";
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Msg { role: string; content: string }

// Which toolkits has this user connected? Ask Composio (the source of truth).
// Returns the toolkit slugs (e.g. ["gmail","googlecalendar"]) of ACTIVE accounts.
async function connectedToolkits(userId: string): Promise<string[]> {
  if (!COMPOSIO_API_KEY) return [];
  try {
    const u = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
    u.searchParams.set("user_ids", userId);
    u.searchParams.set("statuses", "ACTIVE");
    const res = await fetch(u.toString(), { headers: { "x-api-key": COMPOSIO_API_KEY } });
    if (!res.ok) return [];
    const body = await res.json();
    const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
    const slugs = items
      .filter((x) => (x.status ?? "ACTIVE").toUpperCase() === "ACTIVE")
      .map((x) => x.toolkit?.slug ?? x.toolkit_slug ?? (typeof x.toolkit === "string" ? x.toolkit : null))
      .filter((s): s is string => !!s);
    return [...new Set(slugs)];
  } catch {
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response("The assistant isn't configured yet (ANTHROPIC_API_KEY missing on the server).", { status: 500, headers: cors });
  }

  let messages: Msg[];
  try {
    const body = await req.json();
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) throw new Error("bad body");
  } catch {
    return new Response("Invalid request body — expected { messages: [...] }.", { status: 400, headers: cors });
  }

  // Attach the MCP server, scoped to whichever apps the user has connected.
  let mcpServers: unknown[] | undefined;
  const extraHeaders: Record<string, string> = {};
  const apps = await connectedToolkits("primary");
  if (apps.length) {
    const url = `${MCP_URL}?apps=${encodeURIComponent(apps.join(","))}`;
    mcpServers = [{ type: "url", url, name: "connectors", authorization_token: SHARED_SECRET }];
    extraHeaders["anthropic-beta"] = "mcp-client-2025-04-04";
  }

  const reqBody: Record<string, unknown> = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are Go Farther, a helpful, friendly assistant inside a mobile app. Be clear and concise. When connector tools are available (Gmail, Google Calendar, Google Drive, etc.), use them to act on the user's behalf — search and read email, check and create calendar events, find and read files. Always confirm details before sending an email or creating/changing anything.",
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (mcpServers) reqBody.mcp_servers = mcpServers;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...extraHeaders,
    },
    body: JSON.stringify(reqBody),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return new Response(`Assistant error ${upstream.status}: ${errText}`, { status: 502, headers: cors });
  }

  const out = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      const reader = upstream.body!.getReader();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const data = s.slice(5).trim();
            if (data === "[DONE]" || data === "") continue;
            try {
              const evt = JSON.parse(data);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                controller.enqueue(enc.encode(evt.delta.text));
              }
            } catch { /* ignore partial json */ }
          }
        }
      } catch (e) {
        controller.enqueue(enc.encode(`\n⚠️ ${e instanceof Error ? e.message : String(e)}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(out, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
});
