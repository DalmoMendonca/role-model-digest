import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "role-model-digest.db");

export function initDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      weekly_email_opt_in INTEGER DEFAULT 1,
      timezone TEXT DEFAULT 'America/Los_Angeles',
      current_role_model_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_models (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      bio_text TEXT,
      bio_updated_at TEXT,
      notes_text TEXT,
      notes_updated_at TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS role_model_sources (
      id TEXT PRIMARY KEY,
      role_model_id TEXT NOT NULL,
      label TEXT,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (role_model_id) REFERENCES role_models (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS digest_weeks (
      id TEXT PRIMARY KEY,
      role_model_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      summary_text TEXT,
      generated_at TEXT NOT NULL,
      email_sent_at TEXT,
      UNIQUE (role_model_id, week_start),
      FOREIGN KEY (role_model_id) REFERENCES role_models (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS digest_items (
      id TEXT PRIMARY KEY,
      digest_week_id TEXT NOT NULL,
      source_url TEXT,
      source_title TEXT,
      source_type TEXT,
      source_date TEXT,
      summary TEXT,
      content_hash TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (digest_week_id, source_url),
      FOREIGN KEY (digest_week_id) REFERENCES digest_weeks (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS peer_requests (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (requester_id, recipient_id),
      FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS peers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, peer_id),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (peer_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_role_models_user ON role_models (user_id);
    CREATE INDEX IF NOT EXISTS idx_digest_weeks_role ON digest_weeks (role_model_id);
    CREATE INDEX IF NOT EXISTS idx_digest_items_week ON digest_items (digest_week_id);
    CREATE INDEX IF NOT EXISTS idx_peer_requests_recipient ON peer_requests (recipient_id);
  `);

  const roleModelColumns = new Set(
    db.prepare("PRAGMA table_info(role_models)").all().map((row) => row.name)
  );
  if (!roleModelColumns.has("image_url")) {
    db.exec("ALTER TABLE role_models ADD COLUMN image_url TEXT");
  }
  if (!roleModelColumns.has("image_updated_at")) {
    db.exec("ALTER TABLE role_models ADD COLUMN image_updated_at TEXT");
  }

  const digestColumns = new Set(
    db.prepare("PRAGMA table_info(digest_weeks)").all().map((row) => row.name)
  );
  if (!digestColumns.has("topics_json")) {
    db.exec("ALTER TABLE digest_weeks ADD COLUMN topics_json TEXT");
  }
  if (!digestColumns.has("takeaways_json")) {
    db.exec("ALTER TABLE digest_weeks ADD COLUMN takeaways_json TEXT");
  }

  const digestItemColumns = new Set(
    db.prepare("PRAGMA table_info(digest_items)").all().map((row) => row.name)
  );
  if (!digestItemColumns.has("is_official")) {
    db.exec("ALTER TABLE digest_items ADD COLUMN is_official INTEGER DEFAULT 0");
  }

  return db;
}
