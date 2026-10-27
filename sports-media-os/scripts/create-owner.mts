/**
 * Creates (or resets the password of) the workspace owner account.
 * Public sign-up is disabled in V1; this is the supported way to create users.
 *
 *   npm run create-owner -- --email you@example.com --password '••••••••' [--name "Your Name"]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or the legacy
 * SUPABASE_SERVICE_ROLE_KEY) from .env.local / environment. The first account
 * becomes `owner` (database trigger); later accounts become `member`.
 */
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    name: { type: "string" },
  },
});

function exit(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) exit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
if (!values.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) exit("--email is required");
if (!values.password || values.password.length < 12) exit("--password is required (min 12 characters)");

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await admin.auth.admin.createUser({
  email: values.email,
  password: values.password,
  email_confirm: true,
  user_metadata: values.name ? { display_name: values.name } : undefined,
});

if (error) {
  if (error.code !== "email_exists") exit(error.message);
  // idempotent: reset the password of the existing account
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) exit(listError.message);
  const existing = list.users.find((u) => u.email?.toLowerCase() === values.email!.toLowerCase());
  if (!existing) exit("User exists but could not be found");
  const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password: values.password });
  if (updateError) exit(updateError.message);
  console.log(`✔ Password updated for ${values.email}`);
} else {
  const { data: profile } = await admin.from("users").select("role").eq("id", data.user.id).single();
  console.log(`✔ Created ${values.email} (role: ${profile?.role ?? "unknown"})`);
}
