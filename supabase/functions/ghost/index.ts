import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// DEPRECATED. This was a partial port of an old FastAPI backend (/health, /me)
// that validated a custom HS256 JWT via GHOST_JWT_SECRET. Nothing in the
// current app uses it, so the auth logic (and its secret dependency) has been
// removed to shrink the attack surface. Kept only as a harmless responder —
// delete the function entirely from the Supabase dashboard when convenient.

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const path = new URL(req.url).pathname.replace(/^\/functions\/v1/, "").replace(/^\/ghost/, "") || "/";
  if (req.method === "GET" && (path === "/" || path === "/health")) {
    return new Response(JSON.stringify({ status: "ok", service: "ghost", deprecated: true }), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ error: "gone", detail: "This endpoint is retired." }), {
    status: 410,
    headers: { ...CORS, "content-type": "application/json" },
  });
});
