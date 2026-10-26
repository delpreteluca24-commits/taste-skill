#!/usr/bin/env bash
# Fresh box: install Playwright + Chromium only, then run qa-prod.mjs against $BASE.
set -u
cd "$(dirname "$0")/.."
log() { echo "$(date -u +%H:%M:%S) $*" >> /tmp/qa-setup.log; }
mkdir -p /tmp/qa-prod && cd /tmp/qa-prod && npm init -y > /dev/null && npm i --no-audit --no-fund @playwright/test@1.56.0 @supabase/supabase-js > /tmp/qa-ci.log 2>&1; log "deps $?"
sudo -E npx -y playwright@1.56.0 install-deps chromium > /tmp/qa-deps.log 2>&1; npx playwright install chromium > /tmp/qa-pw.log 2>&1; log "browser $?"
cp "$OLDPWD/scripts/qa-prod.mjs" . && node qa-prod.mjs >> /tmp/qa-setup.log 2>&1; log "prod $?"
