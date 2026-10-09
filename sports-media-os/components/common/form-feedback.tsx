import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { FormState } from "@/lib/actions";
import { cn } from "@/lib/utils";

export function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}

/** Top-level form outcome (error or success message) from a server action. */
export function FormMessage<T>({ state, className }: { state: FormState<T>; className?: string }) {
  if (!state) return null;
  if (state.ok && !state.message) return null;
  const isError = !state.ok;
  const text = state.ok ? state.message : state.error;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        isError ? "border-danger/30 bg-danger/10 text-danger" : "border-success/30 bg-success/10 text-success",
        className,
      )}
    >
      {isError ? <AlertCircle className="mt-px size-3.5 shrink-0" /> : <CheckCircle2 className="mt-px size-3.5 shrink-0" />}
      <span>{text}</span>
    </div>
  );
}
