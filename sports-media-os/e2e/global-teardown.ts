import { existsSync, readFileSync, rmSync } from "node:fs";

import { adminClient, E2E_USER_FILE, type E2EUser } from "./support";

export default async function globalTeardown() {
  if (!existsSync(E2E_USER_FILE)) return;
  const user = JSON.parse(readFileSync(E2E_USER_FILE, "utf8")) as E2EUser;
  const admin = adminClient();
  // projects.owner_id is ON DELETE RESTRICT: remove the user's projects first
  await admin.from("settings").delete().is("project_id", null).eq("updated_by", user.id);
  await admin.from("projects").delete().eq("owner_id", user.id);
  await admin.auth.admin.deleteUser(user.id);
  rmSync(E2E_USER_FILE, { force: true });
}
