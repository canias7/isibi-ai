#!/bin/bash
# GoFarther AI — Dependency Security Audit
# Run this regularly to check for known vulnerabilities
# Usage: ./scripts/security-audit.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================="
echo "GoFarther AI — Security Audit"
echo "Date: $(date)"
echo "========================================="
echo ""

# ── Python Dependencies ──────────────────────────────────────────────
echo "── Python Dependencies ──────────────────"
cd "$ROOT_DIR/backend"

if command -v pip-audit &> /dev/null; then
    echo "Running pip-audit..."
    pip-audit 2>/dev/null || echo "  Issues found (see above)"
elif command -v pip &> /dev/null; then
    echo "Running pip audit..."
    pip audit 2>/dev/null || echo "  pip-audit not available. Install with: pip install pip-audit"
else
    echo "  pip not found — skipping Python audit"
fi

echo ""
echo "Critical package versions:"
pip show cryptography 2>/dev/null | grep -E "^(Name|Version):" || true
pip show bcrypt 2>/dev/null | grep -E "^(Name|Version):" || true
pip show python-jose 2>/dev/null | grep -E "^(Name|Version):" || true
pip show httpx 2>/dev/null | grep -E "^(Name|Version):" || true
pip show fastapi 2>/dev/null | grep -E "^(Name|Version):" || true
pip show sqlalchemy 2>/dev/null | grep -E "^(Name|Version):" || true
echo ""

# ── Node.js Dependencies ────────────────────────────────────────────
echo "── Node.js Dependencies ────────────────"
cd "$ROOT_DIR/gofarther-ai"

if command -v npm &> /dev/null; then
    echo "Running npm audit (production only)..."
    npm audit --production 2>&1 || echo "  Issues found (see above)"
else
    echo "  npm not found — skipping Node.js audit"
fi
echo ""

# ── Secrets Check ────────────────────────────────────────────────────
echo "── Secrets Scan ────────────────────────"
echo "Scanning for potential secrets in source code..."

SECRETS_FOUND=0
cd "$ROOT_DIR"

# Check for common secret patterns in non-binary, non-dependency files
for pattern in "API_KEY.*=.*['\"][a-zA-Z0-9]" "SECRET.*=.*['\"][a-zA-Z0-9]" "password.*=.*['\"][^']" "sk-[a-zA-Z0-9]{20,}" "AKIA[0-9A-Z]{16}"; do
    MATCHES=$(grep -rn "$pattern" --include="*.py" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" \
        --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.expo --exclude-dir=__pycache__ \
        --exclude="package-lock.json" --exclude="*.hbc" --exclude="*.map" \
        backend/ gofarther-ai/src/ 2>/dev/null | grep -v "os.getenv\|process.env\|SecureStore\|getItemAsync\|ENV\|example\|placeholder\|test\|mock" || true)
    if [ -n "$MATCHES" ]; then
        echo "  Potential secret pattern found:"
        echo "$MATCHES" | head -5
        SECRETS_FOUND=$((SECRETS_FOUND + 1))
    fi
done

if [ "$SECRETS_FOUND" -eq 0 ]; then
    echo "  No hardcoded secrets detected"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────────────
echo "========================================="
echo "Audit complete."
echo ""
echo "Recommended schedule:"
echo "  - Run this script weekly"
echo "  - Run before each production release"
echo "  - Review and update dependencies monthly"
echo ""
echo "To fix vulnerabilities:"
echo "  Python:  pip install --upgrade <package>"
echo "  Node.js: npm audit fix"
echo "========================================="
