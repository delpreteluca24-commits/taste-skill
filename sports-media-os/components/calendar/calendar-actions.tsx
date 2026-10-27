"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markPublishedAction, scheduleAction } from "@/lib/publishing/actions";

const PLATFORMS = [
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
] as const;

function localDefault() {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setMinutes(0, 0, 0);
  d.setHours(18);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function ScheduleForm({ id, initialPlatforms }: { id: string; initialPlatforms: string[] }) {
  const [when, setWhen] = useState(localDefault);
  const [platforms, setPlatforms] = useState<string[]>(initialPlatforms.length ? initialPlatforms : ["youtube", "tiktok", "instagram"]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await scheduleAction({ id, scheduledAt: new Date(when).toISOString(), platforms });
          setMsg(res.ok ? { ok: true, text: res.message ?? "Scheduled." } : { ok: false, text: res.error });
        });
      }}
    >
      <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Publish date and time" required />
      <div className="flex flex-wrap gap-1.5">
        {PLATFORMS.map((p) => {
          const on = platforms.includes(p.key);
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              onClick={() => setPlatforms((cur) => (on ? cur.filter((x) => x !== p.key) : [...cur, p.key]))}
              className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand bg-brand/15 text-brand" : "text-muted-foreground"}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <Button type="submit" size="sm" variant="brand" disabled={pending}>
        <CalendarPlus /> Schedule
      </Button>
      {msg ? <p className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p> : null}
    </form>
  );
}

export function MarkPublishedForm({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await markPublishedAction({ id, url });
          setMsg(res.ok ? { ok: true, text: res.message ?? "Published." } : { ok: false, text: res.error });
        });
      }}
    >
      <Input type="url" placeholder="Post URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        <Send /> I posted it
      </Button>
      {msg ? <p className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p> : null}
    </form>
  );
}
