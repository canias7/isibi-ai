import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SHARED_SECRET = "717fa3c352eda109dcda2451e97f1254a62c244e526eccbb";
const GMAIL_MCP_URL = "https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/gmail-mcp";
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY");
const GMAIL_AUTH_CONFIG_ID = "ac_LFQFgSsYOYA5";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Msg { role: string; content: string }

// Is Gmail connected for this user? Ask Composio (the source of truth) rather
// than a local token table — Composio owns the connection + tokens now.
async function gmailConnected(userId: string): Promise<boolean> {
  if (!COMPOSIO_API_KEY) return false;
  try {
    const u = new URL("https://backend.composio.dev/api/v3.1/connected_accounts");
    u.searchParams.set("user_ids", userId);
    u.searchParams.set("auth_config_ids", GMAIL_AUTH_CONFIG_ID);
    u.searchParams.set("statuses", "ACTIVE");
    const res = await fetch(u.toString(), { headers: { "x-api-key": COMPOSIO_API_KEY } });
    if (!res.ok) return false;
    const body = await res.json();
    const items: any[] = body.items ?? body.data ?? (Array.isArray(body) ? body : []);
    return items.some((x) => (x.status ?? "").toUpperCase() === "ACTIVE") || items.length > 0;
  } catch {
    return false;
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

  // Attach the Gmail MCP server when the user has connected Gmail via Composio.
  let mcpServers: unknown[] | undefined;
  const extraHeaders: Record<string, string> = {};
  if (await gmailConnected("primary")) {
    mcpServers = [{ type: "url", url: GMAIL_MCP_URL, name: "gmail", authorization_token: SHARED_SECRET }];
    extraHeaders["anthropic-beta"] = "mcp-client-2025-04-04";
  }

  const reqBody: Record<string, unknown> = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are Go Farther, a helpful, friendly assistant inside a mobile app. Be clear and concise. When Gmail tools are available, use them to search, read, and send email on the user's behalf when they ask. Always confirm details before sending an email.",
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
