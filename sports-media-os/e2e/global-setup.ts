import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { adminClient, E2E_USER_FILE, type E2EUser } from "./support";

/** Fresh admin user per run → deterministic onboarding (no projects yet). */
export default async function globalSetup() {
  const admin = adminClient();
  const user: Omit<E2EUser, "id"> = {
    email: `e2e-${Date.now()}@example.test`,
    password: randomBytes(18).toString("base64url"),
  };
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { display_name: "E2E Operator" },
  });
  if (error || !data.user) throw new Error(`E2E user creation failed: ${error?.message}`);

  // workspace settings require an app admin
  const { error: roleError } = await admin.from("users").update({ role: "admin" }).eq("id", data.user.id);
  if (roleError) throw new Error(`E2E role update failed: ${roleError.message}`);

  mkdirSync(dirname(E2E_USER_FILE), { recursive: true });
  writeFileSync(E2E_USER_FILE, JSON.stringify({ id: data.user.id, ...user }), { mode: 0o600 });
}
