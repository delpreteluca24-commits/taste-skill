"use client";

import { useEffect } from "react";

const KEY = "smos:last-drain";
const EVERY_MS = 3 * 60_000;

/**
 * Hosted mode has no always-on worker: opening the app runs due work
 * (source fetches, queued AI jobs) at most every few minutes per browser.
 */
export function DrainKicker() {
  useEffect(() => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY) ?? 0);
    } catch {}
    if (Date.now() - last < EVERY_MS) return;
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    fetch("/api/jobs/drain", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
