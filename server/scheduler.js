import "./env.js";
import cron from "node-cron";
import { generateWeeklyDigest } from "./digestService.js";

export function startScheduler(db) {
  const timezone = process.env.CRON_TIMEZONE || "America/Los_Angeles";
  cron.schedule(
    "0 8 * * 1",
    () => {
      runWeeklyDigests(db).catch(() => null);
    },
    { timezone }
  );
}

async function runWeeklyDigests(db) {
  const rows = db
    .prepare(
      `
      SELECT users.*, role_models.id AS role_model_id, role_models.name AS role_model_name
      FROM users
      INNER JOIN role_models ON role_models.id = users.current_role_model_id
      WHERE role_models.is_active = 1
    `
    )
    .all();

  for (const row of rows) {
    const roleModel = {
      id: row.role_model_id,
      name: row.role_model_name
    };
    await generateWeeklyDigest(db, { user: row, roleModel });
  }
}
