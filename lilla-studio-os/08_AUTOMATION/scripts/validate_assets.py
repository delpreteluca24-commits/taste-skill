#!/usr/bin/env python3
"""Read-only integrity check: structure, asset naming, duplicates, secrets. Exit 1 on errors."""
import hashlib, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REQUIRED = ["README.md", "CLAUDE.md", "AGENT_PROTOCOL.md", "00_CORE/budget.md", "00_CORE/current-state.md",
            "00_CORE/decision-log.md", "08_AUTOMATION/configs/autonomy.yml"]
AGENTS = ["00_ceo", "01_market", "02_ip_creative", "03_story", "04_production", "05_audio", "06_growth", "07_cfo", "08_publishing"]
NAME = re.compile(r"^(img|vid|aud|mus|thm|ref)_[a-z0-9]+_[a-z0-9-]+_[a-z0-9-]+_v\d{2}\.[a-z0-9]+$")
SECRET = re.compile(r"(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")
errors, warns, seen = [], [], {}
for f in REQUIRED:
    if not os.path.isfile(os.path.join(ROOT, f)): errors.append(f"missing {f}")
for a in AGENTS:
    for f in ("ROLE.md", "MEMORY.md", "TASKS.md"):
        if not os.path.isfile(os.path.join(ROOT, "01_AGENTS", a, f)): errors.append(f"missing 01_AGENTS/{a}/{f}")
for dp, _, fs in os.walk(ROOT):
    if "/.git" in dp: continue
    for fn in fs:
        p = os.path.join(dp, fn); rel = os.path.relpath(p, ROOT)
        if fn == ".gitkeep": continue
        if rel.startswith("04_ASSETS/") and not fn.endswith((".md", ".json", ".csv")):
            if not NAME.match(fn): errors.append(f"bad asset name: {rel}")
            if os.path.getsize(p) > 5 * 1024 * 1024: warns.append(f">5MB, move to Drive: {rel}")
            h = hashlib.sha256(open(p, "rb").read()).hexdigest()
            if h in seen: warns.append(f"duplicate: {rel} == {seen[h]}")
            seen[h] = rel
        if os.path.getsize(p) < 2_000_000:
            try:
                if SECRET.search(open(p, encoding="utf-8", errors="ignore").read()): errors.append(f"possible secret: {rel}")
            except OSError: pass
for w in warns: print("WARN ", w)
for e in errors: print("ERROR", e)
print(f"integrity: {len(errors)} errors, {len(warns)} warnings")
sys.exit(1 if errors else 0)
