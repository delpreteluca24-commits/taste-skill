"use server";

import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

const schema = z
  .object({
    current: z.string().min(1, "Enter your current password").max(128),
    next: z.string().min(10, "Use at least 10 characters").max(128),
    confirm: z.string().max(128),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "The two passwords differ" })
  .refine((v) => v.next !== v.current, { path: ["next"], message: "Pick a password different from the current one" });

/** Change the signed-in user's password; the current one is re-checked first. */
export async function changePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = schema.safeParse({ current: formData.get("current"), next: formData.get("next"), confirm: formData.get("confirm") });
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  const supabase = await createClient();
  const check = await supabase.auth.signInWithPassword({ email: user.email, password: parsed.data.current });
  if (check.error) return fail(check.error.status === 429 ? "Too many attempts. Wait a minute and retry." : "The current password is wrong.");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.next });
  if (error) {
    logger.warn("auth.password_change_failed", { code: error.code ?? null, status: error.status ?? null });
    return fail(error.code === "weak_password" ? "That password is too weak. Make it longer." : "Could not change the password. Retry.");
  }
  logger.info("auth.password_changed", { userId: user.id });
  return ok(undefined, "Password changed.");
}
