#!/usr/bin/env bash
# PromptMesh Validation & Auto-Fix Script
# Checks for common issues documented in CLAUDE.md and fixes them automatically.
# Exit code 0 = all good (or all fixed), 1 = unfixable issues remain.

set -euo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

FIXED=0
ERRORS=0
WARNINGS=0

fix()    { FIXED=$((FIXED+1));   echo -e "  ${GREEN}FIXED${NC}   $1"; }
warn()   { WARNINGS=$((WARNINGS+1)); echo -e "  ${YELLOW}WARN${NC}    $1"; }
err()    { ERRORS=$((ERRORS+1)); echo -e "  ${RED}ERROR${NC}   $1"; }
ok()     { echo -e "  ${GREEN}OK${NC}      $1"; }

REQUIRED_MODEL="claude-haiku-4-5-20251001"
REQUIRED_PAGES=(
  "promptmesh-studio.html"
  "promptmesh-enterprise.html"
  "promptmesh-dev.html"
  "promptmesh-sysai.html"
)
HUB_PAGES=(
  "index.html"
  "promptmesh-hub.html"
)
ALL_HTML=( "${HUB_PAGES[@]}" "${REQUIRED_PAGES[@]}" )

echo "=== PromptMesh Validator ==="
echo ""

# ---------------------------------------------------------------
# 1. Check all required files exist
# ---------------------------------------------------------------
echo "[1] Required files"
for f in "${ALL_HTML[@]}" "agent/promptmesh_agent.py" "netlify.toml"; do
  if [[ -f "$f" ]]; then
    ok "$f exists"
  else
    err "$f is MISSING"
  fi
done
echo ""

# ---------------------------------------------------------------
# 2. Check CSP meta tags exist in every HTML file
# ---------------------------------------------------------------
echo "[2] CSP meta tags"
for f in "${ALL_HTML[@]}"; do
  [[ ! -f "$f" ]] && continue
  if grep -q 'Content-Security-Policy' "$f"; then
    ok "$f has CSP meta tag"
  else
    err "$f is MISSING CSP meta tag (cannot auto-fix — add manually)"
  fi
done
echo ""

# ---------------------------------------------------------------
# 3. Default model consistency
# ---------------------------------------------------------------
echo "[3] Default AI model ($REQUIRED_MODEL)"
for f in "${REQUIRED_PAGES[@]}"; do
  [[ ! -f "$f" ]] && continue
  if grep -q "defaultModel:'${REQUIRED_MODEL}'" "$f"; then
    ok "$f uses correct default model"
  else
    # Try to fix: replace any defaultModel:'claude-...' with the correct one
    if grep -q "defaultModel:'claude-" "$f"; then
      sed -i "s/defaultModel:'claude-[^']*'/defaultModel:'${REQUIRED_MODEL}'/g" "$f"
      fix "$f default model corrected"
    else
      warn "$f — could not find defaultModel to fix"
    fi
  fi
done
echo ""

# ---------------------------------------------------------------
# 4. API key storage — must use sessionStorage, never localStorage for keys
# ---------------------------------------------------------------
echo "[4] API key storage (sessionStorage only)"
for f in "${ALL_HTML[@]}"; do
  [[ ! -f "$f" ]] && continue
  if grep -q "localStorage.*pm_key" "$f"; then
    # Fix: replace localStorage references for pm_key with sessionStorage
    sed -i 's/localStorage\(\.\(get\|set\|remove\)Item(.*pm_key\)/sessionStorage\1/g' "$f"
    fix "$f — changed localStorage pm_key access to sessionStorage"
  else
    ok "$f — no localStorage key leaks"
  fi
done
echo ""

# ---------------------------------------------------------------
# 5. Dark mode key consistency (pm_dark in localStorage)
# ---------------------------------------------------------------
echo "[5] Dark mode key (pm_dark)"
for f in "${ALL_HTML[@]}"; do
  [[ ! -f "$f" ]] && continue
  if grep -q "pm_dark" "$f"; then
    ok "$f references pm_dark"
  else
    # Hub pages that toggle dark mode should have it
    if grep -q "toggleDark\|dark-toggle\|darkToggle" "$f"; then
      warn "$f has dark toggle but does NOT use pm_dark key"
    fi
  fi
done
echo ""

# ---------------------------------------------------------------
# 6. FILES object — hub pages must list all products
# ---------------------------------------------------------------
echo "[6] FILES object in hub pages"
for f in "${HUB_PAGES[@]}"; do
  [[ ! -f "$f" ]] && continue
  missing_products=()
  for p in "${REQUIRED_PAGES[@]}"; do
    key="${p%.html}"           # promptmesh-studio
    key="${key#promptmesh-}"   # studio
    if ! grep -q "'$p'" "$f" && ! grep -q "\"$p\"" "$f"; then
      missing_products+=("$p")
    fi
  done
  if [[ ${#missing_products[@]} -eq 0 ]]; then
    ok "$f FILES object has all products"
  else
    err "$f FILES missing: ${missing_products[*]} (add manually)"
  fi
done
echo ""

# ---------------------------------------------------------------
# 7. Compare table sync — index.html must match hub
# ---------------------------------------------------------------
echo "[7] Compare table sync (index.html <-> promptmesh-hub.html)"
if [[ -f "index.html" && -f "promptmesh-hub.html" ]]; then
  # Extract compare tables from both files
  idx_table=$(sed -n '/<table class="compare-table">/,/<\/table>/p' index.html)
  hub_table=$(sed -n '/<table class="compare-table">/,/<\/table>/p' promptmesh-hub.html)

  if [[ "$idx_table" == "$hub_table" ]]; then
    ok "Compare tables are in sync"
  else
    # Auto-fix: copy hub's table into index.html
    # Use Python for reliable multi-line replacement
    python3 -c "
import re
with open('promptmesh-hub.html') as f:
    hub = f.read()
with open('index.html') as f:
    idx = f.read()
pat = r'<table class=\"compare-table\">.*?</table>'
hub_table = re.search(pat, hub, re.DOTALL)
if hub_table:
    idx_new = re.sub(pat, hub_table.group(0), idx, count=1, flags=re.DOTALL)
    with open('index.html', 'w') as f:
        f.write(idx_new)
"
    fix "Copied compare table from promptmesh-hub.html -> index.html"
  fi
else
  warn "Cannot compare — one of index.html / promptmesh-hub.html is missing"
fi
echo ""

# ---------------------------------------------------------------
# 8. Product cards sync — index.html must match hub
# ---------------------------------------------------------------
echo "[8] Product cards sync (index.html <-> promptmesh-hub.html)"
if [[ -f "index.html" && -f "promptmesh-hub.html" ]]; then
  idx_cards=$(grep -c 'class="product-card' index.html || true)
  hub_cards=$(grep -c 'class="product-card' promptmesh-hub.html || true)

  if [[ "$idx_cards" == "$hub_cards" ]]; then
    ok "Both have $idx_cards product cards"
  else
    warn "index.html has $idx_cards cards, hub has $hub_cards cards — review manually"
  fi
else
  warn "Cannot compare product cards"
fi
echo ""

# ---------------------------------------------------------------
# 9. SysAI CSP includes localhost:7842
# ---------------------------------------------------------------
echo "[9] SysAI localhost CSP"
if [[ -f "promptmesh-sysai.html" ]]; then
  if grep -q 'localhost:7842' promptmesh-sysai.html; then
    ok "SysAI CSP includes localhost:7842"
  else
    warn "SysAI CSP missing localhost:7842 for local agent"
  fi
fi
echo ""

# ---------------------------------------------------------------
# 10. netlify.toml sanity
# ---------------------------------------------------------------
echo "[10] netlify.toml"
if [[ -f "netlify.toml" ]]; then
  if grep -q 'publish = "."' netlify.toml; then
    ok "publish = \".\""
  else
    err "netlify.toml publish is not set to \".\""
  fi
  if grep -q 'api.anthropic.com' netlify.toml; then
    ok "CSP includes api.anthropic.com"
  else
    err "netlify.toml CSP missing api.anthropic.com"
  fi
fi
echo ""

# ---------------------------------------------------------------
# 11. Check for common JS issues
# ---------------------------------------------------------------
echo "[11] Basic JS checks"
for f in "${ALL_HTML[@]}"; do
  [[ ! -f "$f" ]] && continue
  # Check for console.log left in (warning only)
  count=$(grep -c 'console\.log' "$f" 2>/dev/null || true)
  if [[ "$count" -gt 5 ]]; then
    warn "$f has $count console.log statements"
  fi
done
echo ""

# ---------------------------------------------------------------
# 12. Back-links — sub-pages should link back to hub
# ---------------------------------------------------------------
echo "[12] Back-links to hub"
for f in "${REQUIRED_PAGES[@]}"; do
  [[ ! -f "$f" ]] && continue
  if grep -q 'promptmesh-hub.html' "$f"; then
    ok "$f links back to hub"
  else
    warn "$f has no link back to promptmesh-hub.html"
  fi
done
echo ""

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
echo "=== Summary ==="
echo -e "  ${GREEN}Fixed:${NC}    $FIXED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "  ${RED}Errors:${NC}   $ERRORS"
echo ""

if [[ $ERRORS -gt 0 ]]; then
  echo -e "${RED}Validation failed with $ERRORS error(s).${NC}"
  exit 1
elif [[ $FIXED -gt 0 ]]; then
  echo -e "${GREEN}All issues auto-fixed. Re-run to confirm.${NC}"
  exit 0
else
  echo -e "${GREEN}All checks passed.${NC}"
  exit 0
fi
