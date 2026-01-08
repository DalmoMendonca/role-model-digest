import "./env.js";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import expressSession from "express-session";
import passport from "passport";
import path from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import { createSessionToken, getCookieOptions, requireAuth } from "./auth.js";
import { initDb } from "./db.js";
import { generateBio } from "./agents/bioAgent.js";
import { generateWeeklyDigest, getDigestsForRoleModel } from "./digestService.js";
import { validateRoleModel } from "./agents/roleModelValidator.js";
import { fetchRoleModelImage } from "./agents/sourceAgent.js";
import { sendInviteEmail } from "./email.js";
import { setupGoogleAuth } from "./googleAuth.js";
import { startScheduler } from "./scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const db = initDb();
setupGoogleAuth(db);
startScheduler(db);
const PASSWORD_AUTH_ENABLED = false;

app.use(expressSession({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 14 // 14 days
  }
}));

app.use(passport.initialize());
app.use(passport.session());

const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
const clientOrigin = process.env.CLIENT_ORIGIN || corsOrigin;

app.use(
  cors({
    origin: corsOrigin,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const authRequired = requireAuth(db);

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    weeklyEmailOptIn: !!user.weekly_email_opt_in,
    timezone: user.timezone,
    currentRoleModelId: user.current_role_model_id
  };
}

function getCurrentRoleModel(user) {
  if (!user.current_role_model_id) return null;
  return db
    .prepare("SELECT * FROM role_models WHERE id = ?")
    .get(user.current_role_model_id);
}

app.post("/api/auth/signup", (req, res) => {
  if (!PASSWORD_AUTH_ENABLED) {
    return res.status(403).json({ error: "Password sign-in is disabled. Use Google." });
  }
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const normalizedEmail = email.toLowerCase();
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const userId = nanoid();
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, weekly_email_opt_in, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    userId,
    normalizedEmail,
    passwordHash,
    displayName,
    1,
    new Date().toISOString()
  );

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const token = createSessionToken(user);
  res.cookie("session", token, getCookieOptions());

  return res.json({ user: toPublicUser(user), roleModel: null });
});

app.post("/api/auth/login", (req, res) => {
  if (!PASSWORD_AUTH_ENABLED) {
    return res.status(403).json({ error: "Password sign-in is disabled. Use Google." });
  }
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = createSessionToken(user);
  res.cookie("session", token, getCookieOptions());
  const roleModel = getCurrentRoleModel(user);
  return res.json({
    user: toPublicUser(user),
    roleModel: roleModel ? mapRoleModel(roleModel) : null
  });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("session");
  res.status(204).end();
});

// Google OAuth routes
app.get(
  "/api/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"], prompt: "select_account" })
);

app.get(
  "/api/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${clientOrigin}/?auth=google&status=error`
  }),
  (req, res) => {
    const token = createSessionToken(req.user);
    res.cookie("session", token, getCookieOptions());
    res.redirect(`${clientOrigin}/?auth=google&status=success`);
  }
);

app.get("/api/me", authRequired, (req, res) => {
  const roleModel = getCurrentRoleModel(req.user);
  res.json({
    user: toPublicUser(req.user),
    roleModel: roleModel ? mapRoleModel(roleModel) : null
  });
});

app.post("/api/role-model", authRequired, async (req, res) => {
  const { name } = req.body || {};
  const normalizedName = (name || "").trim();
  if (!normalizedName) {
    return res.status(400).json({ error: "Role model name required" });
  }

  try {
    const validation = await validateRoleModel({ name: normalizedName });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.reason });
    }
  } catch (error) {
    console.error("Role model validation failed", error);
    let message = "Role model validation unavailable";
    const detail = typeof error?.detail === "string" ? error.detail : "";
    const loweredDetail = detail.toLowerCase();
    const loweredMessage =
      typeof error?.message === "string" ? error.message.toLowerCase() : "";

    if (error?.code === "SERPER_API_KEY_MISSING") {
      message =
        "Search provider key missing. Set SERPER_API_KEY to enable validation.";
    } else if (error?.code === "SEARCH_PROVIDER_UNAVAILABLE") {
      if (loweredDetail.includes("not enough credits") || loweredMessage.includes("not enough credits")) {
        message =
          "Search provider out of credits. Add Serper credits to continue.";
      } else if (detail) {
        message = `Search provider unavailable: ${detail}`;
      } else {
        message = "Search provider unavailable. Please try again shortly.";
      }
    }

    return res.status(503).json({ error: message });
  }

  db.prepare("UPDATE role_models SET is_active = 0 WHERE user_id = ?").run(req.user.id);

  const roleModelId = nanoid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO role_models (id, user_id, name, created_at, is_active)
    VALUES (?, ?, ?, ?, 1)
  `
  ).run(roleModelId, req.user.id, normalizedName, createdAt);

  let bioText = "";
  try {
    const bioResponse = await generateBio({ name: normalizedName });
    bioText = bioResponse.bioText || "";
  } catch (error) {
    console.error("Bio generation failed", error);
    bioText = "Bio unavailable right now. Try regenerating in a bit.";
  }
  db.prepare(
    "UPDATE role_models SET bio_text = ?, bio_updated_at = ? WHERE id = ?"
  ).run(bioText, new Date().toISOString(), roleModelId);

  try {
    const image = await fetchRoleModelImage({ roleModelName: normalizedName });
    if (image?.imageUrl) {
      db.prepare(
        "UPDATE role_models SET image_url = ?, image_updated_at = ? WHERE id = ?"
      ).run(image.imageUrl, new Date().toISOString(), roleModelId);
    }
  } catch (error) {
    console.warn("Role model image fetch failed", error);
  }

  db.prepare("UPDATE users SET current_role_model_id = ? WHERE id = ?").run(
    roleModelId,
    req.user.id
  );

  const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const roleModel = db.prepare("SELECT * FROM role_models WHERE id = ?").get(roleModelId);

  res.json({ user: toPublicUser(updatedUser), roleModel: mapRoleModel(roleModel) });
});

app.patch("/api/role-model", authRequired, (req, res) => {
  const { notes } = req.body || {};
  const roleModel = getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.status(400).json({ error: "No role model set" });
  }

  db.prepare(
    "UPDATE role_models SET notes_text = ?, notes_updated_at = ? WHERE id = ?"
  ).run(notes, new Date().toISOString(), roleModel.id);

  const updated = db.prepare("SELECT * FROM role_models WHERE id = ?").get(roleModel.id);
  res.json({ roleModel: mapRoleModel(updated) });
});

app.post("/api/role-model/bio", authRequired, async (req, res) => {
  const roleModel = getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.status(400).json({ error: "No role model set" });
  }

  let bioText = "";
  try {
    const bioResponse = await generateBio({ name: roleModel.name });
    bioText = bioResponse.bioText || "";
  } catch (error) {
    console.error("Bio generation failed", error);
    return res.status(502).json({ error: "Bio generation failed" });
  }
  db.prepare(
    "UPDATE role_models SET bio_text = ?, bio_updated_at = ? WHERE id = ?"
  ).run(bioText, new Date().toISOString(), roleModel.id);

  const updated = db.prepare("SELECT * FROM role_models WHERE id = ?").get(roleModel.id);
  res.json({ bioText, roleModel: mapRoleModel(updated) });
});

app.get("/api/bio", authRequired, (req, res) => {
  const roleModel = getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.json({ bioText: "", notesText: "" });
  }

  res.json({
    bioText: roleModel.bio_text || "",
    notesText: roleModel.notes_text || ""
  });
});

app.get("/api/role-model/image", authRequired, async (req, res) => {
  const roleModel = getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.status(400).json({ error: "No role model set" });
  }

  const forceRefresh = req.query.refresh === "1";
  const existingUrl = roleModel.image_url || "";

  if (existingUrl && !forceRefresh) {
    return res.json({ imageUrl: roleModel.image_url });
  }

  try {
    const image = await fetchRoleModelImage({ roleModelName: roleModel.name });
    if (!image?.imageUrl) {
      return res.json({ imageUrl: existingUrl });
    }
    db.prepare(
      "UPDATE role_models SET image_url = ?, image_updated_at = ? WHERE id = ?"
    ).run(image.imageUrl, new Date().toISOString(), roleModel.id);
    return res.json({ imageUrl: image.imageUrl });
  } catch (error) {
    console.warn("Role model image fetch failed", error);
    if (existingUrl) {
      return res.json({ imageUrl: existingUrl });
    }
    return res.status(502).json({ error: "Role model image lookup failed" });
  }
});

app.get("/api/digests", authRequired, (req, res) => {
  const roleModel = getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.json({ digests: [] });
  }
  const digests = getDigestsForRoleModel(db, roleModel.id);
  res.json({ digests });
});

app.get("/api/digests/share/:id", (req, res) => {
  const digestId = req.params.id;
  const digest = db
    .prepare(
      `
      SELECT
        digest_weeks.id AS id,
        digest_weeks.week_start AS week_start,
        digest_weeks.summary_text AS summary_text,
        digest_weeks.generated_at AS generated_at,
        role_models.name AS role_model_name,
        role_models.image_url AS role_model_image
      FROM digest_weeks
      INNER JOIN role_models ON role_models.id = digest_weeks.role_model_id
      WHERE digest_weeks.id = ?
    `
    )
    .get(digestId);

  if (!digest) {
    return res.status(404).json({ error: "Digest not found" });
  }

  const items = db
    .prepare(
      `
      SELECT
        id,
        source_title,
        source_url,
        source_type,
        source_date,
        summary,
        is_official
      FROM digest_items
      WHERE digest_week_id = ?
      ORDER BY created_at ASC
    `
    )
    .all(digestId)
    .map((item) => ({
      id: item.id,
      sourceTitle: item.source_title,
      sourceUrl: item.source_url,
      sourceType: item.source_type,
      sourceDate: item.source_date,
      summary: item.summary,
      isOfficial: !!item.is_official
    }));

  res.json({
    digest: {
      id: digest.id,
      weekStart: digest.week_start,
      summaryText: digest.summary_text,
      generatedAt: digest.generated_at,
      roleModelName: digest.role_model_name,
      roleModelImage: digest.role_model_image || "",
      items
    }
  });
});

app.post("/api/digests/run", authRequired, async (req, res) => {
  const roleModel = getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.status(400).json({ error: "No role model set" });
  }
  try {
    const digests = await generateWeeklyDigest(db, {
      user: req.user,
      roleModel,
      force: true
    });
    res.json({ digests });
  } catch (error) {
    console.error("Digest generation failed", error);
    const detail = typeof error?.message === "string" ? error.message : "";
    const message = detail
      ? `Digest generation failed: ${detail}`
      : "Digest generation failed";
    res.status(502).json({ error: message });
  }
});

app.patch("/api/preferences", authRequired, (req, res) => {
  const { weeklyEmailOptIn, timezone } = req.body || {};
  const nextEmailOptIn = weeklyEmailOptIn ? 1 : 0;
  const nextTimezone = timezone || req.user.timezone;

  db.prepare(
    "UPDATE users SET weekly_email_opt_in = ?, timezone = ? WHERE id = ?"
  ).run(nextEmailOptIn, nextTimezone, req.user.id);

  const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: toPublicUser(updatedUser) });
});

app.get("/api/social/peers", authRequired, (req, res) => {
  const peerRows = db
    .prepare(
      `
      SELECT peers.peer_id, users.display_name, role_models.name AS role_model_name
      FROM peers
      INNER JOIN users ON users.id = peers.peer_id
      LEFT JOIN role_models ON role_models.id = users.current_role_model_id
      WHERE peers.user_id = ?
    `
    )
    .all(req.user.id);

  const incoming = db
    .prepare(
      `
      SELECT peer_requests.id, users.display_name AS requester_name
      FROM peer_requests
      INNER JOIN users ON users.id = peer_requests.requester_id
      WHERE peer_requests.recipient_id = ? AND peer_requests.status = 'pending'
    `
    )
    .all(req.user.id);

  const outgoing = db
    .prepare(
      `
      SELECT peer_requests.id, users.display_name AS recipient_name
      FROM peer_requests
      INNER JOIN users ON users.id = peer_requests.recipient_id
      WHERE peer_requests.requester_id = ? AND peer_requests.status = 'pending'
    `
    )
    .all(req.user.id);

  res.json({
    peers: peerRows.map((peer) => ({
      id: peer.peer_id,
      displayName: peer.display_name,
      roleModelName: peer.role_model_name
    })),
    incomingRequests: incoming.map((req) => ({
      id: req.id,
      requesterName: req.requester_name
    })),
    outgoingRequests: outgoing.map((req) => ({
      id: req.id,
      recipientName: req.recipient_name
    }))
  });
});

app.post("/api/social/requests", authRequired, (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  const recipient = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!recipient) {
    const roleModel = getCurrentRoleModel(req.user);
    sendInviteEmail({
      to: email,
      inviterName: req.user.display_name || req.user.email,
      roleModelName: roleModel?.name || "a role model"
    })
      .then((invite) =>
        res.json({ status: "invited", delivery: invite?.status || "sent" })
      )
      .catch((error) => {
        console.error("Invite email failed", error);
        res.status(502).json({ error: "Invite email failed" });
      });
    return;
  }

  if (recipient.id === req.user.id) {
    return res.status(400).json({ error: "Cannot add yourself" });
  }

  const existingPeer = db
    .prepare("SELECT id FROM peers WHERE user_id = ? AND peer_id = ?")
    .get(req.user.id, recipient.id);
  if (existingPeer) {
    return res.status(409).json({ error: "Already connected" });
  }

  const requestId = nanoid();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT OR IGNORE INTO peer_requests
    (id, requester_id, recipient_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `
  ).run(requestId, req.user.id, recipient.id, now, now);

  res.json({ status: "sent" });
});

app.post("/api/social/requests/:id/accept", authRequired, (req, res) => {
  const { id } = req.params;
  const request = db
    .prepare("SELECT * FROM peer_requests WHERE id = ? AND recipient_id = ?")
    .get(id, req.user.id);
  if (!request) {
    return res.status(404).json({ error: "Request not found" });
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE peer_requests SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, id);

  const insertPeer = db.prepare(
    "INSERT OR IGNORE INTO peers (id, user_id, peer_id, created_at) VALUES (?, ?, ?, ?)"
  );
  insertPeer.run(nanoid(), req.user.id, request.requester_id, now);
  insertPeer.run(nanoid(), request.requester_id, req.user.id, now);

  res.json({ status: "accepted" });
});

app.post("/api/social/requests/:id/decline", authRequired, (req, res) => {
  const { id } = req.params;
  const request = db
    .prepare("SELECT * FROM peer_requests WHERE id = ? AND recipient_id = ?")
    .get(id, req.user.id);
  if (!request) {
    return res.status(404).json({ error: "Request not found" });
  }

  db.prepare("UPDATE peer_requests SET status = 'declined', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id
  );

  res.json({ status: "declined" });
});

app.get("/api/social/timeline", authRequired, (req, res) => {
  const query = (req.query.q || "").toString().toLowerCase();

  const rows = db
    .prepare(
      `
      SELECT
        users.display_name AS peer_name,
        role_models.name AS role_model_name,
        role_models.bio_text AS bio_text,
        digest_weeks.summary_text AS summary_text,
        digest_weeks.week_start AS week_start
      FROM peers
      INNER JOIN users ON users.id = peers.peer_id
      LEFT JOIN role_models ON role_models.id = users.current_role_model_id
      LEFT JOIN digest_weeks ON digest_weeks.role_model_id = role_models.id
      WHERE peers.user_id = ?
      ORDER BY digest_weeks.week_start DESC
    `
    )
    .all(req.user.id);

  const entries = rows
    .map((row) => ({
      id: nanoid(),
      peerName: row.peer_name,
      roleModelName: row.role_model_name || "",
      bioText: row.bio_text || "",
      latestDigestSummary: row.summary_text || "",
      latestDigestWeek: row.week_start || ""
    }))
    .filter((entry) => {
      if (!query) return true;
      return (
        entry.peerName.toLowerCase().includes(query) ||
        entry.roleModelName.toLowerCase().includes(query) ||
        entry.bioText.toLowerCase().includes(query) ||
        entry.latestDigestSummary.toLowerCase().includes(query)
      );
    });

  res.json({ entries });
});

function mapRoleModel(roleModel) {
  return {
    id: roleModel.id,
    name: roleModel.name,
    bioText: roleModel.bio_text || "",
    notesText: roleModel.notes_text || "",
    imageUrl: roleModel.image_url || "",
    bioUpdatedAt: roleModel.bio_updated_at,
    notesUpdatedAt: roleModel.notes_updated_at
  };
}

if (process.env.NODE_ENV === "production") {
  const clientDir = path.join(__dirname, "..", "dist");
  app.use(express.static(clientDir));
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`Role Model Digest server running on ${port}`);
});
