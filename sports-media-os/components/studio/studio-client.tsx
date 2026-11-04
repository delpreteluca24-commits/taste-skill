"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Check, Copy, Download, Plus, Sparkles } from "lucide-react";

import { FormMessage } from "@/components/common/form-feedback";
import { JobStatus } from "@/components/jobs/job-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addManualPackageAction, generatePackageAction, selectTitleAction } from "@/lib/publishing/actions";
import { cn } from "@/lib/utils";

export function GeneratePackageButton({ contentItemId, hasPackage, disabledReason }: { contentItemId: string; hasPackage: boolean; disabledReason?: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2">
      <Button
        variant={hasPackage ? "outline" : "brand"}
        disabled={pending || Boolean(disabledReason)}
        title={disabledReason}
        onClick={() =>
          start(async () => {
            const res = await generatePackageAction(contentItemId);
            if (res.ok) {
              setError(null);
              setJobId(res.data.jobId);
            } else setError(res.error);
          })
        }
      >
        <Sparkles />
        {hasPackage ? "More titles & thumbnails" : "Generate titles & thumbnails"}
      </Button>
      {disabledReason ? <p className="text-xs text-muted-foreground">{disabledReason}</p> : null}
      {jobId ? <JobStatus jobId={jobId} label="Packaging" /> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function TitleOption({ id, text, score, selected }: { id: string; text: string; score: number | null; selected: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending || selected}
      onClick={() => start(async () => void (await selectTitleAction(id)))}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        selected ? "border-brand bg-brand/10" : "hover:border-brand/40 hover:bg-accent/40",
      )}
    >
      <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", selected && "border-brand bg-brand text-brand-foreground")}>
        {selected ? <Check className="size-3" /> : null}
      </span>
      <span className="flex-1">{text}</span>
      <span className="font-display text-lg font-bold tabular text-muted-foreground">{score === null ? "–" : Math.round(score)}</span>
    </button>
  );
}

export function PackageExport({ markdown, filename }: { markdown: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="brand"
        onClick={() => {
          const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
          const a = Object.assign(document.createElement("a"), { href: url, download: filename });
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        <Download /> Download package
      </Button>
      <Button
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(markdown);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Write your own title / thumbnail headline (works without AI). */
export function ManualPackageForm({ contentItemId, kind }: { contentItemId: string; kind: "title" | "thumbnail" }) {
  const [state, action, pending] = useActionState(addManualPackageAction, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  const label = kind === "title" ? "Your own title" : "Your own thumbnail headline";
  return (
    <form ref={form} action={action} className="grid gap-1.5">
      <input type="hidden" name="contentItemId" value={contentItemId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-2">
        <Input name="text" aria-label={label} placeholder={`${label}…`} maxLength={kind === "title" ? 200 : 120} required />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <Plus /> Add
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
