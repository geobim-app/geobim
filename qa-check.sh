#!/bin/bash
# ============================================================
# geobim.app — Quality Assurance Check Script
#
# Run before each release: bash qa-check.sh
# Checks CSS consistency, JS syntax, dead references,
# color consistency, accessibility, and performance patterns.
#
# Exit code: 0 = all pass, 1 = warnings, 2 = errors
# ============================================================

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ERRORS=0
WARNINGS=0

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

pass()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; WARNINGS=$((WARNINGS+1)); }
fail()  { echo -e "  ${RED}✗${NC} $1"; ERRORS=$((ERRORS+1)); }
section() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

cd "$DIR"

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   geobim.app Quality Assurance Check     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"

# ============================================================
section "1. FILE INTEGRITY"
# ============================================================

# Check all JS files referenced in index.html exist (skip commented-out lines)
for f in $(grep -v '<!--' index.html | grep -oP 'src="([^"]+\.js)"' | sed 's/src="//;s/"//'); do
  if [[ "$f" == http* ]]; then continue; fi
  if [ -f "$f" ]; then
    pass "$f exists"
  else
    fail "$f referenced in index.html but MISSING"
  fi
done

# Check all CSS files referenced in index.html exist
for f in $(grep -oP 'href="([^"]+\.css)"' index.html | sed 's/href="//;s/"//'); do
  if [[ "$f" == http* ]]; then continue; fi
  if [ -f "$f" ]; then
    pass "$f exists"
  else
    fail "$f referenced in index.html but MISSING"
  fi
done

# ============================================================
section "2. JS SYNTAX CHECK"
# ============================================================

if command -v node &>/dev/null; then
  SYNTAX_ERRORS=0
  for f in *.js; do
    [[ "$f" == "config.js" || "$f" == "config.example.js" ]] && continue
    if node --check "$f" 2>/dev/null; then
      : # silent pass
    else
      fail "Syntax error in $f"
      SYNTAX_ERRORS=$((SYNTAX_ERRORS+1))
    fi
  done
  if [ $SYNTAX_ERRORS -eq 0 ]; then
    pass "All $(ls *.js | wc -l) JS files pass syntax check"
  fi
else
  warn "Node.js not installed — skipping syntax check"
fi

# ============================================================
section "3. COLOR CONSISTENCY"
# ============================================================

# Check for legacy teal
LEGACY=$(grep -rl '#6EECD8\|rgba(110, 236, 216\|rgba(110,236,216' *.css *.js 2>/dev/null | grep -v cesium_sdk | grep -v node_modules || true)
if [ -z "$LEGACY" ]; then
  pass "No legacy teal #6EECD8 found"
else
  fail "Legacy teal #6EECD8 still in: $LEGACY"
fi

# Check for hardcoded colors that should use CSS variables
HARDCODED=$(grep -rn '#0E1117\|#141922\|#1a202c' *.css 2>/dev/null | grep -v 'var(' | grep -v '/\*' || true)
if [ -z "$HARDCODED" ]; then
  pass "No hardcoded dark surface colors outside CSS vars"
else
  warn "Hardcoded colors found (should use CSS vars):\n$HARDCODED" | head -5
fi

# ============================================================
section "4. CSS REFERENCES"
# ============================================================

# Check for IDs in CSS that don't exist in HTML/JS
# Skip hex colors (#FFFFFF etc.) and CSS-only selectors
CSS_IDS=$(grep -ohP '#[a-zA-Z][a-zA-Z0-9_-]+' style.css | grep -vP '^#[0-9A-Fa-f]{3,8}$' | sort -u)
MISSING_IDS=0
for id in $CSS_IDS; do
  ID_NAME="${id#\#}"
  # Skip common CSS patterns
  [[ "$ID_NAME" =~ ^(tourMask|tourSpotlight) ]] && continue
  if ! grep -rq "id=\"$ID_NAME\"\|id='$ID_NAME'\|getElementById('$ID_NAME')\|getElementById(\"$ID_NAME\")\|#$ID_NAME" index.html *.js 2>/dev/null; then
    # Check if it's created dynamically
    if ! grep -rq "'$ID_NAME'\|\"$ID_NAME\"" *.js 2>/dev/null; then
      warn "CSS ID #$ID_NAME not found in HTML/JS"
      MISSING_IDS=$((MISSING_IDS+1))
    fi
  fi
done
[ $MISSING_IDS -eq 0 ] && pass "All CSS IDs reference existing elements"

# ============================================================
section "5. KEYBOARD SHORTCUTS"
# ============================================================

# Check for shortcut conflicts
echo "  Shortcut map:"
# Look for single-letter key handlers in keydown listeners
for KEY in g v w h b m t p r c a; do
  HANDLERS=$(grep -rn "=== '$KEY'" *.js 2>/dev/null | grep -i 'key\|\.key' | grep -v cesium_sdk | grep -v '// ' | wc -l)
  FILES=$(grep -rl "=== '$KEY'" *.js 2>/dev/null | grep -v cesium_sdk | xargs -I{} basename {} | sort -u | tr '\n' ', ')
  if [ "$HANDLERS" -gt 2 ]; then
    warn "Key '$KEY' in $HANDLERS handlers: $FILES"
  elif [ "$HANDLERS" -gt 0 ]; then
    pass "Key '$KEY': $HANDLERS handler(s)"
  fi
done

# ============================================================
section "6. ACCESSIBILITY"
# ============================================================

# Check for prefers-reduced-motion
if grep -q 'prefers-reduced-motion' style.css; then
  pass "prefers-reduced-motion media query present"
else
  fail "Missing prefers-reduced-motion support"
fi

# Check for focus-visible
if grep -q 'focus-visible' style.css; then
  pass "focus-visible styles present"
else
  fail "Missing focus-visible styles"
fi

# Check for ARIA labels on interactive elements
BUTTONS_NO_TITLE=$(grep -c '<button.*onclick' index.html 2>/dev/null || echo 0)
BUTTONS_WITH_TITLE=$(grep -c '<button.*title=' index.html 2>/dev/null || echo 0)
if [ "$BUTTONS_WITH_TITLE" -lt "$BUTTONS_NO_TITLE" ]; then
  warn "$((BUTTONS_NO_TITLE - BUTTONS_WITH_TITLE)) buttons without title attribute in index.html"
else
  pass "All buttons have title attributes"
fi

# ============================================================
section "7. PERFORMANCE PATTERNS"
# ============================================================

# Check for transition: all (performance anti-pattern)
ALL_TRANSITIONS=$(grep -c 'transition: all' style.css 2>/dev/null || echo 0)
if [ "$ALL_TRANSITIONS" -gt 5 ]; then
  warn "$ALL_TRANSITIONS instances of 'transition: all' in style.css (should scope to specific properties)"
else
  pass "Minimal use of transition: all ($ALL_TRANSITIONS)"
fi

# Check for layout-triggering animations
LAYOUT_ANIMS=$(grep -c 'animation.*width\|animation.*height\|animation.*top\|animation.*left' style.css 2>/dev/null || echo "0")
LAYOUT_ANIMS=$(echo "$LAYOUT_ANIMS" | tr -d '[:space:]')
if [ "$LAYOUT_ANIMS" -gt 0 ]; then
  warn "$LAYOUT_ANIMS layout-triggering animations found"
else
  pass "No layout-triggering animations"
fi

# ============================================================
section "8. SECURITY"
# ============================================================

# Check for exposed secrets
if grep -rq 'AIzaSy\|sk-\|AKIA\|ghp_\|glpat-' *.js 2>/dev/null; then
  # Exclude Firebase public config (which is intentionally public)
  NON_FIREBASE=$(grep -rn 'AIzaSy\|sk-\|AKIA\|ghp_\|glpat-' *.js 2>/dev/null | grep -v config.js | grep -v auth || true)
  if [ -n "$NON_FIREBASE" ]; then
    fail "Potential secrets found outside config.js"
  else
    pass "API keys only in config.js (expected)"
  fi
else
  pass "No exposed secrets found"
fi

# Check for innerHTML with user input
INNERHTML=$(grep -rn 'innerHTML.*=.*\(input\|value\|text\)' *.js 2>/dev/null | grep -v cesium_sdk | wc -l)
if [ "$INNERHTML" -gt 0 ]; then
  warn "$INNERHTML innerHTML assignments with potential user input (check for XSS)"
fi

# ============================================================
section "9. DEAD CODE"
# ============================================================

# Check for console.log in production (excluding debug/error/warn)
CONSOLE_LOGS=$(grep -rn 'console\.log' *.js 2>/dev/null | grep -v cesium_sdk | grep -v '// ' | wc -l)
if [ "$CONSOLE_LOGS" -gt 50 ]; then
  warn "$CONSOLE_LOGS console.log statements (consider removing for production)"
else
  pass "Console.log count: $CONSOLE_LOGS (acceptable)"
fi

# ============================================================
section "10. ASSET INTEGRITY"
# ============================================================

# Check critical assets exist
for asset in model/Cesium_Man.glb logo/logo_teal_transparent.svg favicon.svg; do
  if [ -f "$asset" ]; then
    pass "$asset exists ($(du -h "$asset" | cut -f1))"
  else
    fail "$asset MISSING"
  fi
done

# ============================================================
# SUMMARY
# ============================================================

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}  RESULT: $ERRORS error(s), $WARNINGS warning(s)${NC}"
  exit 2
elif [ $WARNINGS -gt 0 ]; then
  echo -e "${YELLOW}  RESULT: 0 errors, $WARNINGS warning(s)${NC}"
  exit 1
else
  echo -e "${GREEN}  RESULT: All checks passed!${NC}"
  exit 0
fi
