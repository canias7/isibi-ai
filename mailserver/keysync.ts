// keysync.ts — pulls every verified domain's DKIM private key from the app and
// installs it into OpenDKIM so the box can sign for all customer domains.
//
// Runs on a timer (gofarther-keysync.timer, ~every 2 min). It calls the `mailer`
// edge function's machine-only `keysync_export` action (authenticated with the
// shared RELAY_TOKEN), writes each key to /etc/opendkim/keys/<domain>/<sel>.private,
// regenerates the KeyTable + SigningTable, and reloads OpenDKIM — but only when
// something actually changed, so it's quiet on idle ticks.
//
// The private key never touches the browser: it lives in a service-role-only DB
// table and only leaves via this token-gated export, straight onto our own box.
//
// Run:  deno run --allow-net --allow-env --allow-read --allow-write \
//         --allow-run=chown,chmod,systemctl keysync.ts
// (systemd unit: gofarther-keysync.service, triggered by the .timer)

const MAILER_URL = (Deno.env.get("MAILER_URL") ?? "").replace(/\/+$/, "");
const RELAY_TOKEN = Deno.env.get("RELAY_TOKEN") ?? "";
const SB_ANON = Deno.env.get("SB_ANON") ?? "";
const KEYS_DIR = Deno.env.get("KEYS_DIR") ?? "/etc/opendkim/keys";
const KEY_TABLE = Deno.env.get("KEY_TABLE") ?? "/etc/opendkim/key.table";
const SIGNING_TABLE = Deno.env.get("SIGNING_TABLE") ?? "/etc/opendkim/signing.table";

if (!MAILER_URL || !RELAY_TOKEN) {
  console.error("MAILER_URL and RELAY_TOKEN are required");
  Deno.exit(1);
}

interface KeyRow { domain: string; selector: string; private_pem: string }

async function fetchKeys(): Promise<KeyRow[]> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${RELAY_TOKEN}`,
    "content-type": "application/json",
  };
  if (SB_ANON) headers.apikey = SB_ANON;
  const res = await fetch(`${MAILER_URL}`, { method: "POST", headers, body: JSON.stringify({ action: "keysync_export" }) });
  if (!res.ok) throw new Error(`keysync_export ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return Array.isArray(j?.keys) ? j.keys : [];
}

async function run(cmd: string, ...args: string[]): Promise<void> {
  const { code, stderr } = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  if (code !== 0) throw new Error(`${cmd} ${args.join(" ")} -> ${new TextDecoder().decode(stderr).trim()}`);
}

async function readOrEmpty(path: string): Promise<string> {
  try { return await Deno.readTextFile(path); } catch { return ""; }
}

async function main() {
  const keys = await fetchKeys();
  // Deterministic order so unchanged input produces byte-identical tables.
  keys.sort((a, b) => a.domain.localeCompare(b.domain));

  const keyTableLines: string[] = [];
  const signingTableLines: string[] = [];
  let changed = false;

  for (const k of keys) {
    if (!/^[a-z0-9.-]+$/i.test(k.domain) || !/^[a-z0-9_]+$/i.test(k.selector)) {
      console.error("skipping malformed row:", k.domain, k.selector);
      continue;
    }
    const dir = `${KEYS_DIR}/${k.domain}`;
    const keyPath = `${dir}/${k.selector}.private`;
    const pem = k.private_pem.trim() + "\n";
    if ((await readOrEmpty(keyPath)) !== pem) {
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(keyPath, pem, { mode: 0o600 });
      changed = true;
    }
    keyTableLines.push(`${k.selector}._domainkey.${k.domain} ${k.domain}:${k.selector}:${keyPath}`);
    signingTableLines.push(`*@${k.domain} ${k.selector}._domainkey.${k.domain}`);
  }

  const keyTable = keyTableLines.join("\n") + (keyTableLines.length ? "\n" : "");
  const signingTable = signingTableLines.join("\n") + (signingTableLines.length ? "\n" : "");
  if ((await readOrEmpty(KEY_TABLE)) !== keyTable) { await Deno.writeTextFile(KEY_TABLE, keyTable); changed = true; }
  if ((await readOrEmpty(SIGNING_TABLE)) !== signingTable) { await Deno.writeTextFile(SIGNING_TABLE, signingTable); changed = true; }

  if (!changed) { console.log(`keysync: no changes (${keys.length} domains)`); return; }

  // Lock the keys down so OpenDKIM accepts them, then reload.
  await run("chown", "-R", "opendkim:opendkim", KEYS_DIR);
  await run("chmod", "-R", "u+rwX,go-rwx", KEYS_DIR);
  try {
    await run("systemctl", "reload", "opendkim");
  } catch {
    await run("systemctl", "restart", "opendkim");
  }
  console.log(`keysync: applied ${keys.length} domains, reloaded OpenDKIM`);
}

main().catch((e) => { console.error("keysync failed:", e.message ?? e); Deno.exit(1); });
