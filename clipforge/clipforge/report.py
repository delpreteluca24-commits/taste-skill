"""Step 8 — report.html: previews, scores and metadata for every exported clip."""
from __future__ import annotations

from html import escape
from pathlib import Path

from .cache import atomic_write_text
from .chunking import fmt_ts

CSS = """
:root{--bg:#f6f6f4;--card:#fff;--fg:#1b1b1b;--muted:#6b6b6b;--line:#e3e3df;--accent:#e6007e}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--card:#1d1d1d;--fg:#f1f1f1;--muted:#a3a3a3;--line:#2c2c2c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
header{padding:24px 16px;max-width:1200px;margin:auto}h1{margin:0 0 4px;font-size:22px}
.meta{color:var(--muted);font-size:13px}
main{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));padding:0 16px 40px;max-width:1200px;margin:auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
video{width:100%;aspect-ratio:9/16;background:#000;display:block}
.body{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.score{font-weight:700;font-size:18px;color:var(--accent)}
.hook{font-weight:700}.tags{color:var(--muted);font-size:13px;word-break:break-word}
.reason{font-size:13px;color:var(--muted)}a{color:inherit}
"""


def build_report(out_dir: Path, source_title: str, source: str, clips: list[dict]) -> Path:
    cards = []
    for c in clips:
        files = c["files"]
        cards.append(f"""<article class="card">
<video src="{escape(files['video'])}" poster="{escape(files.get('thumbnail', ''))}" controls preload="none"></video>
<div class="body">
 <div class="row"><span class="score">{c['score']}</span><span class="meta">#{c['idx']:02d} · {fmt_ts(c['start'])}–{fmt_ts(c['end'])} · {c['duration']:.0f}s</span></div>
 <div class="hook">{escape(c['hook_title'])}</div>
 <div>{escape(c['title'])}</div>
 <div class="meta">{escape(c['description'])}</div>
 <div class="tags">{escape(' '.join(c['hashtags']))}</div>
 <div class="reason">{escape(c['reason'])}</div>
 <div class="meta"><a href="{escape(files['video'])}" download>mp4</a> · <a href="{escape(Path(files['video']).with_suffix('.json').name)}">json</a></div>
</div></article>""")
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ClipForge report</title><style>{CSS}</style></head>
<body><header><h1>{escape(source_title)}</h1><div class="meta">{escape(source)} · {len(clips)} clips, sorted by score</div></header>
<main>{''.join(cards)}</main></body></html>"""
    path = Path(out_dir) / "report.html"
    atomic_write_text(path, html)
    return path
