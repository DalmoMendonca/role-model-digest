import "./env.js";
import cron from "node-cron";
import { generateWeeklyDigest } from "./digestService.js";

export function startScheduler(db) {
  // Run every Monday at 9:00 AM Central time
  const timezone = process.env.CRON_TIMEZONE || "America/Chicago";
  cron.schedule(
    "0 9 * * 1",
    () => {
      runWeeklyDigests(db).catch((err) => {
        console.error("Weekly digest run failed", err);
      });
    },
    { timezone }
  );
}

async function runWeeklyDigests(db) {
  // Fetch all users who have any active role model, not just their current one.
  // This ensures users whose current_role_model_id was recently changed still
  // receive digests for all their active role models.
  const rows = db
    .prepare(
      `
      SELECT users.*, role_models.id AS role_model_id, role_models.name AS role_model_name
      FROM users
      INNER JOIN role_models ON role_models.user_id = users.id
      WHERE role_models.is_active = 1
    `
    )
    .all();

  console.log(`[scheduler] Starting weekly digest run for ${rows.length} user/role-model pairs`);

  const results = { success: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    const roleModel = {
      id: row.role_model_id,
      name: row.role_model_name
    };
    try {
      await generateWeeklyDigest(db, { user: row, roleModel });
      results.success++;
      console.log(`[scheduler] ✓ Digest generated for ${row.email} / ${roleModel.name}`);
    } catch (err) {
      // Isolate failures so one bad digest doesn't abort the rest
      results.failed++;
      console.error(
        `[scheduler] ✗ Digest failed for ${row.email} / ${roleModel.name}`,
        err?.message || err
      );
    }
  }

  console.log(
    `[scheduler] Weekly digest run complete — success: ${results.success}, skipped: ${results.skipped}, failed: ${results.failed}`
  );
}
