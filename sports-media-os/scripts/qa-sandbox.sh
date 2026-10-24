#!/usr/bin/env bash
# One-shot unattended QA in a fresh Linux box (e.g. a Vercel Sandbox):
# install, build, start the app against the configured Supabase, run qa-run.mjs.
# Progress lines go to /tmp/qa-setup.log; the report goes to public.qa_runs.
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
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3000/login && break; sleep 1; done
log "server up"
for kind in ${QA_KINDS:-sweep}; do
  QA_KIND="$kind" node scripts/qa-run.mjs >> /tmp/qa-setup.log 2>&1; log "run $kind $?"
done
log done
