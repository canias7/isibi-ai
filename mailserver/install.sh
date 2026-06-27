#!/usr/bin/env bash
# install.sh — install the Go Farther multi-tenant sender onto an Ubuntu box that
# already runs Postfix + OpenDKIM (e.g. the proven Contabo lab, re-pointed to
# gofarther.dev). Idempotent: safe to re-run. Run as root, from this directory.
#
#   sudo bash install.sh
#
# It does NOT change Postfix identity (myhostname/mydomain) or rDNS — those are
# conscious, one-time steps in PRODUCTION-SETUP.md. It DOES wire OpenDKIM to the
# keysync-managed tables + the Postfix milter, and installs the relay + keysync.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

echo "==> 1/8 Deno"
if ! command -v deno >/dev/null 2>&1; then
  curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
fi
DENO=/usr/local/bin/deno
[ -x "$DENO" ] || DENO="$(command -v deno)"

echo "==> 2/8 service user + dirs"
id -u gofarther >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin gofarther
install -d -m 755 /opt/gofarther
install -m 755 "$DIR/relay.ts" /opt/gofarther/relay.ts
install -m 755 "$DIR/keysync.ts" /opt/gofarther/keysync.ts
install -d -m 750 /etc/gofarther

echo "==> 3/8 env file"
if [ ! -f /etc/gofarther/mailer.env ]; then
  cp "$DIR/mailer.env.example" /etc/gofarther/mailer.env
  echo "    created /etc/gofarther/mailer.env — EDIT IT: set RELAY_TOKEN (openssl rand -hex 32)"
fi
chown root:gofarther /etc/gofarther/mailer.env
chmod 640 /etc/gofarther/mailer.env
# shellcheck disable=SC1091
set -a; . /etc/gofarther/mailer.env; set +a
RELAY_HOST="${RELAY_HOST:-relay.gofarther.dev}"

echo "==> 4/8 OpenDKIM config (tables + safe-keys + milter socket)"
set_conf() {  # file key value
  local f="$1" k="$2" v="$3"
  if grep -qiE "^[[:space:]]*${k}([[:space:]]|$)" "$f"; then
    sed -i -E "s|^[[:space:]]*${k}([[:space:]].*)?$|${k} ${v}|I" "$f"
  else
    echo "${k} ${v}" >> "$f"
  fi
}
CONF=/etc/opendkim.conf
[ -f "$CONF" ] || { echo "    $CONF not found — is OpenDKIM installed?"; exit 1; }
set_conf "$CONF" "KeyTable"        "${KEY_TABLE:-/etc/opendkim/key.table}"
set_conf "$CONF" "SigningTable"    "refile:${SIGNING_TABLE:-/etc/opendkim/signing.table}"
set_conf "$CONF" "UserID"          "opendkim"
set_conf "$CONF" "RequireSafeKeys" "false"
set_conf "$CONF" "Socket"          "inet:8891@localhost"
set_conf "$CONF" "Mode"            "sv"
set_conf "$CONF" "Canonicalization" "relaxed/simple"
install -d -o opendkim -g opendkim -m 750 "${KEYS_DIR:-/etc/opendkim/keys}"
touch "${KEY_TABLE:-/etc/opendkim/key.table}" "${SIGNING_TABLE:-/etc/opendkim/signing.table}"

echo "==> 5/8 Postfix milter wiring"
postconf -e "milter_default_action=accept"
postconf -e "milter_protocol=6"
postconf -e "smtpd_milters=inet:localhost:8891"
postconf -e "non_smtpd_milters=inet:localhost:8891"

echo "==> 6/8 Caddy (auto-TLS in front of the relay)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update >/dev/null && apt-get install -y caddy >/dev/null
fi
printf '%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$RELAY_HOST" "${RELAY_PORT:-8025}" > /etc/caddy/Caddyfile
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "==> 7/8 systemd units"
install -m 644 "$DIR/systemd/gofarther-relay.service"   /etc/systemd/system/
install -m 644 "$DIR/systemd/gofarther-keysync.service" /etc/systemd/system/
install -m 644 "$DIR/systemd/gofarther-keysync.timer"   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now opendkim postfix
systemctl restart opendkim
systemctl enable --now gofarther-relay.service
systemctl enable --now gofarther-keysync.timer

echo "==> 8/8 first key sync"
systemctl start gofarther-keysync.service || true

echo
echo "Done. Checks:"
echo "  systemctl status gofarther-relay --no-pager"
echo "  journalctl -u gofarther-keysync -n 30 --no-pager"
echo "  curl -fsS https://${RELAY_HOST}/health   # {\"ok\":true}"
echo
echo "If RELAY_TOKEN was just set, also set the SAME value as the edge function"
echo "secret MAILER_RELAY_TOKEN and MAILER_RELAY_URL=https://${RELAY_HOST} (see PRODUCTION-SETUP.md)."
