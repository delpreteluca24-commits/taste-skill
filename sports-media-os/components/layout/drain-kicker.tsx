"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const KEY = "smos:last-drain";
const EVERY_MS = 3 * 60_000;

/**
 * Hosted mode has no always-on worker: opening the app runs due work
 * (source fetches, trend detection, queued AI jobs) at most every few minutes
 * per browser, then refreshes the page if anything ran.
 */
export function DrainKicker() {
  const router = useRouter();
  useEffect(() => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY) ?? 0);
    } catch {}
    if (Date.now() - last < EVERY_MS) return;
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    let cancelled = false;
    fetch("/api/jobs/drain", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((res: { ran?: number; scheduled?: number } | null) => {
        if (!cancelled && res && ((res.ran ?? 0) > 0 || (res.scheduled ?? 0) > 0)) router.refresh();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
