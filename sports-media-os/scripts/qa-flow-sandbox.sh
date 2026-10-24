#!/usr/bin/env bash
# Fresh Linux box (Vercel Sandbox): install, build, start, run qa-flow.mjs.
# Progress → /tmp/qa-setup.log; results → public.qa_runs / qa_shots.
set -u
cd "$(dirname "$0")/.."
log() { echo "$(date -u +%H:%M:%S) $*" >> /tmp/qa-setup.log; }
log start
(sudo -E npx -y playwright@1.56.0 install-deps chromium > /tmp/qa-deps.log 2>&1; log "deps $?") &
npm ci --no-audit --no-fund > /tmp/qa-ci.log 2>&1; log "ci $?"
npx playwright install chromium > /tmp/qa-pw.log 2>&1; log "browser $?"
npm run build > /tmp/qa-build.log 2>&1; log "build $?"
wait
(nohup npx next start -p 3000 > /tmp/qa-server.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:3000/login && break; sleep 1; done
log "server up"
node scripts/qa-flow.mjs >> /tmp/qa-setup.log 2>&1; log "flow $?"
log done
