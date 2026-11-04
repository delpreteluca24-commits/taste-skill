"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, type ActionResult } from "@/lib/actions";
import { safeRedirectPath } from "@/lib/auth/paths";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.email({ message: "Enter a valid email" }).max(254),
  password: z.string().min(8, { message: "Password must be at least 8 characters" }).max(128),
  next: z.string().max(512).optional(),
});

export async function signIn(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // same message for unknown email / wrong password: no account enumeration
    return fail(error.status === 429 ? "Too many attempts. Wait a minute and retry." : "Invalid email or password.");
  }

  redirect(safeRedirectPath(parsed.data.next));
}
