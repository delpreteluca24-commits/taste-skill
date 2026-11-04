"use client";

import { useActionState, useEffect, useRef } from "react";
import { KeyRound } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/lib/auth/password-actions";

const FIELDS = [
  { name: "current", label: "Current password", autoComplete: "current-password" },
  { name: "next", label: "New password (10+ characters)", autoComplete: "new-password" },
  { name: "confirm", label: "Repeat the new password", autoComplete: "new-password" },
] as const;

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form ref={form} action={action} className="grid max-w-sm gap-3" data-testid="password-form">
      {FIELDS.map((f) => (
        <div key={f.name} className="grid gap-1.5">
          <Label htmlFor={`pw-${f.name}`}>{f.label}</Label>
          <Input id={`pw-${f.name}`} name={f.name} type="password" autoComplete={f.autoComplete} required />
          <FieldError messages={errors?.[f.name]} />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="brand" disabled={pending}>
          <KeyRound /> Change password
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
