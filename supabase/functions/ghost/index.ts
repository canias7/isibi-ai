import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jwtVerify } from "npm:jose@5";

/**
 * ghost — Edge Function entry point for the GoFarther AI backend, replacing the
 * old Render FastAPI service mounted at /api/ghost. Routes are ported from the
 * FastAPI app (on the `main` branch) incrementally. Implemented so far:
 *
 *   GET /health   -> liveness check (no auth)
 *   GET /me       -> validates the app's custom HS256 JWT (partial port)
 *
 * Everything else returns 404 "route not migrated yet".
 *
 * Auth note: the app sends its OWN HS256 JWT (signed with the legacy backend's
 * JWT_SECRET), not a Supabase JWT — so this function is deployed with
 * verify_jwt=false and validates the token itself. Set the GHOST_JWT_SECRET
 * function secret to the legacy JWT_SECRET so existing tokens keep working.
 */

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-workspace-id, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Routes already ported into this function. Keep in sync as we migrate more.
const MIGRATED = ["/health", "/me"];

/** Verify the app's custom bearer JWT and return its claims (or null if absent). */
async function getClaims(req: Request): Promise<Record<string, unknown> | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const secret = Deno.env.get("GHOST_JWT_SECRET");
  if (!secret) throw new Error("GHOST_JWT_SECRET not configured");
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  });
  return payload as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  // Strip the platform prefix and function name so sub-paths match /api/ghost/*.
  const path = url.pathname.replace(/^\/functions\/v1/, "").replace(/^\/ghost/, "") || "/";

  // Liveness — no auth required.
  if (req.method === "GET" && (path === "/" || path === "/health")) {
    return json({
      status: "ok",
      service: "ghost",
      migrated: MIGRATED,
      ts: new Date().toISOString(),
    });
  }

  // Current user — validates the app's custom JWT.
  if (req.method === "GET" && path === "/me") {
    try {
      const claims = await getClaims(req);
      if (!claims) return json({ error: "missing bearer token" }, 401);
      // TODO: hydrate from the ghost_users table (credits, plan, settings) once
      // the schema is migrated. For now we return the verified token claims.
      return json({ user_id: claims.sub ?? null, email: claims.email ?? null, claims });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unauthorized";
      const status = msg.includes("GHOST_JWT_SECRET") ? 501 : 401;
      return json({ error: msg }, status);
    }
  }

  // Not yet ported from the FastAPI backend.
  return json(
    { error: "route not migrated yet", path, ported: MIGRATED },
    404,
  );
});
