import "./env.js";
import admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { generateBio } from "./agents/bioAgent.js";
import { validateRoleModel } from "./agents/roleModelValidator.js";
import { fetchRoleModelImage } from "./agents/sourceAgent.js";
import {
  generateWeeklyDigest,
  getDigestsForRoleModel,
  getPublicDigest
} from "./digestService.js";
import { sendInviteEmail } from "./email.js";

admin.initializeApp();
const db = admin.firestore();

const app = express();
const allowedOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.CLIENT_ORIGIN_DEV
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    weeklyEmailOptIn: !!user.weeklyEmailOptIn,
    timezone: user.timezone,
    currentRoleModelId: user.currentRoleModelId || null
  };
}

function mapRoleModel(doc) {
  const data = doc?.data ? doc.data() : doc;
  if (!data) return null;
  return {
    id: data.id || doc?.id,
    name: data.name,
    bioText: data.bioText || "",
    notesText: data.notesText || "",
    imageUrl: data.imageUrl || "",
    bioUpdatedAt: data.bioUpdatedAt || null,
    notesUpdatedAt: data.notesUpdatedAt || null
  };
}

async function ensureUserDoc(decoded) {
  const userRef = db.collection("users").doc(decoded.uid);
  const snapshot = await userRef.get();
  const normalizedEmail = decoded.email ? decoded.email.toLowerCase() : "";
  const fallbackName = normalizedEmail ? normalizedEmail.split("@")[0] : "User";
  if (!snapshot.exists) {
    const payload = {
      id: decoded.uid,
      email: normalizedEmail,
      displayName: decoded.name || fallbackName,
      weeklyEmailOptIn: true,
      timezone: "America/Los_Angeles",
      currentRoleModelId: null,
      createdAt: new Date().toISOString()
    };
    await userRef.set(payload);
    await attachPendingPeerRequests(decoded.uid, normalizedEmail);
    return payload;
  }
  const data = snapshot.data();
  const updates = {};
  if (!data.displayName && (decoded.name || fallbackName)) {
    updates.displayName = decoded.name || fallbackName;
  }
  if (normalizedEmail && data.email !== normalizedEmail) {
    updates.email = normalizedEmail;
  }
  if (typeof data.weeklyEmailOptIn !== "boolean") {
    updates.weeklyEmailOptIn = true;
  }
  if (Object.keys(updates).length) {
    await userRef.update(updates);
  }
  await attachPendingPeerRequests(decoded.uid, normalizedEmail);
  return { ...data, ...updates, id: decoded.uid };
}

async function attachPendingPeerRequests(userId, normalizedEmail) {
  if (!userId || !normalizedEmail) return;
  const pendingSnap = await db
    .collection("peerRequests")
    .where("recipientEmail", "==", normalizedEmail)
    .get();
  if (pendingSnap.empty) return;
  const now = new Date().toISOString();
  const batch = db.batch();
  pendingSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (data.status && data.status !== "pending") return;
    if (data.recipientId === userId) return;
    batch.update(doc.ref, { recipientId: userId, updatedAt: now });
  });
  await batch.commit();
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const user = await ensureUserDoc(decoded);
    req.user = user;
    req.userId = decoded.uid;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

async function getCurrentRoleModel(user) {
  if (!user?.currentRoleModelId) return null;
  const doc = await db.collection("roleModels").doc(user.currentRoleModelId).get();
  if (!doc.exists) return null;
  return mapRoleModel(doc);
}

app.get("/api/me", requireAuth, async (req, res) => {
  const roleModel = await getCurrentRoleModel(req.user);
  res.json({
    user: toPublicUser(req.user),
    roleModel
  });
});

app.post("/api/role-model", requireAuth, async (req, res) => {
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

  const roleModelsRef = db.collection("roleModels");
  const activeModels = await roleModelsRef
    .where("userId", "==", req.userId)
    .where("isActive", "==", true)
    .get();
  const batch = db.batch();
  activeModels.forEach((doc) => {
    batch.update(doc.ref, { isActive: false });
  });

  const roleModelId = nanoid();
  const createdAt = new Date().toISOString();
  const roleModelPayload = {
    id: roleModelId,
    userId: req.userId,
    name: normalizedName,
    bioText: "",
    notesText: "",
    imageUrl: "",
    bioUpdatedAt: null,
    notesUpdatedAt: null,
    imageUpdatedAt: null,
    isActive: true,
    createdAt
  };
  const roleModelRef = roleModelsRef.doc(roleModelId);
  batch.set(roleModelRef, roleModelPayload);
  batch.update(db.collection("users").doc(req.userId), {
    currentRoleModelId: roleModelId
  });
  await batch.commit();

  let bioText = "";
  try {
    const bioResponse = await generateBio({ name: normalizedName });
    bioText = bioResponse.bioText || "";
  } catch (error) {
    console.error("Bio generation failed", error);
    bioText = "Bio unavailable right now. Try regenerating in a bit.";
  }
  await roleModelRef.update({
    bioText,
    bioUpdatedAt: new Date().toISOString()
  });

  try {
    const image = await fetchRoleModelImage({ roleModelName: normalizedName });
    if (image?.imageUrl) {
      await roleModelRef.update({
        imageUrl: image.imageUrl,
        imageUpdatedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.warn("Role model image fetch failed", error);
  }

  const userDoc = await db.collection("users").doc(req.userId).get();
  const roleModelDoc = await roleModelRef.get();
  res.json({
    user: toPublicUser({ ...userDoc.data(), id: userDoc.id }),
    roleModel: mapRoleModel(roleModelDoc)
  });
});

app.patch("/api/role-model", requireAuth, async (req, res) => {
  const { notes } = req.body || {};
  const roleModel = await getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.status(400).json({ error: "No role model set" });
  }

  const ref = db.collection("roleModels").doc(roleModel.id);
  await ref.update({
    notesText: notes || "",
    notesUpdatedAt: new Date().toISOString()
  });
  const updated = await ref.get();
  res.json({ roleModel: mapRoleModel(updated) });
});

app.post("/api/role-model/bio", requireAuth, async (req, res) => {
  const roleModel = await getCurrentRoleModel(req.user);
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
  const ref = db.collection("roleModels").doc(roleModel.id);
  await ref.update({ bioText, bioUpdatedAt: new Date().toISOString() });
  const updated = await ref.get();
  res.json({ bioText, roleModel: mapRoleModel(updated) });
});

app.get("/api/bio", requireAuth, async (req, res) => {
  const roleModel = await getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.json({ bioText: "", notesText: "" });
  }

  res.json({
    bioText: roleModel.bioText || "",
    notesText: roleModel.notesText || ""
  });
});

app.get("/api/role-model/image", requireAuth, async (req, res) => {
  const roleModel = await getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.status(400).json({ error: "No role model set" });
  }

  const forceRefresh = req.query.refresh === "1";
  const existingUrl = roleModel.imageUrl || "";

  if (existingUrl && !forceRefresh) {
    return res.json({ imageUrl: existingUrl });
  }

  try {
    const image = await fetchRoleModelImage({ roleModelName: roleModel.name });
    if (!image?.imageUrl) {
      return res.json({ imageUrl: existingUrl });
    }
    await db.collection("roleModels").doc(roleModel.id).update({
      imageUrl: image.imageUrl,
      imageUpdatedAt: new Date().toISOString()
    });
    return res.json({ imageUrl: image.imageUrl });
  } catch (error) {
    console.warn("Role model image fetch failed", error);
    if (existingUrl) {
      return res.json({ imageUrl: existingUrl });
    }
    return res.status(502).json({ error: "Role model image lookup failed" });
  }
});

app.get("/api/digests", requireAuth, async (req, res) => {
  const roleModel = await getCurrentRoleModel(req.user);
  if (!roleModel) {
    return res.json({ digests: [] });
  }
  const digests = await getDigestsForRoleModel(db, roleModel.id);
  res.json({ digests });
});

app.post("/api/digests/run", requireAuth, async (req, res) => {
  const roleModel = await getCurrentRoleModel(req.user);
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

app.get("/api/digests/share/:id", async (req, res) => {
  const digest = await getPublicDigest(db, req.params.id);
  if (!digest) {
    return res.status(404).json({ error: "Digest not found" });
  }
  res.json({ digest });
});

app.patch("/api/preferences", requireAuth, async (req, res) => {
  const { weeklyEmailOptIn, timezone } = req.body || {};
  const updates = {
    weeklyEmailOptIn: !!weeklyEmailOptIn,
    timezone: timezone || req.user.timezone || "America/Los_Angeles"
  };

  await db.collection("users").doc(req.userId).update(updates);
  const updated = await db.collection("users").doc(req.userId).get();
  res.json({ user: toPublicUser({ ...updated.data(), id: updated.id }) });
});

app.get("/api/social/peers", requireAuth, async (req, res) => {
  const peerRows = await db
    .collection("peers")
    .where("userId", "==", req.userId)
    .get();

  const peers = [];
  for (const doc of peerRows.docs) {
    const peerId = doc.data().peerId;
    const peerUserDoc = await db.collection("users").doc(peerId).get();
    const peerUser = peerUserDoc.data();
    let roleModelName = "";
    if (peerUser?.currentRoleModelId) {
      const roleDoc = await db.collection("roleModels").doc(peerUser.currentRoleModelId).get();
      roleModelName = roleDoc.data()?.name || "";
    }
    peers.push({
      id: peerId,
      displayName: peerUser?.displayName || "",
      roleModelName
    });
  }

  const incomingSnap = await db
    .collection("peerRequests")
    .where("recipientId", "==", req.userId)
    .where("status", "==", "pending")
    .get();

  const outgoingSnap = await db
    .collection("peerRequests")
    .where("requesterId", "==", req.userId)
    .where("status", "==", "pending")
    .get();

  const incomingRequests = [];
  for (const doc of incomingSnap.docs) {
    const requester = await db.collection("users").doc(doc.data().requesterId).get();
    incomingRequests.push({
      id: doc.id,
      requesterName: requester.data()?.displayName || ""
    });
  }

  const outgoingRequests = [];
  for (const doc of outgoingSnap.docs) {
    const recipientId = doc.data().recipientId;
    let recipientName = "";
    if (recipientId) {
      const recipient = await db.collection("users").doc(recipientId).get();
      recipientName = recipient.data()?.displayName || "";
    }
    if (!recipientName) {
      recipientName = doc.data().recipientEmail || "";
    }
    outgoingRequests.push({
      id: doc.id,
      recipientName
    });
  }

  res.json({ peers, incomingRequests, outgoingRequests });
});

app.post("/api/social/requests", requireAuth, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  const normalizedEmail = email.toLowerCase();
  if (normalizedEmail === req.user.email) {
    return res.status(400).json({ error: "Cannot add yourself" });
  }

  const recipientSnap = await db
    .collection("users")
    .where("email", "==", normalizedEmail)
    .limit(1)
    .get();

  if (recipientSnap.empty) {
    const existingInvite = await db
      .collection("peerRequests")
      .where("requesterId", "==", req.userId)
      .where("recipientEmail", "==", normalizedEmail)
      .limit(1)
      .get();
    if (!existingInvite.empty) {
      return res.status(409).json({ error: "Already requested" });
    }

    const requestId = nanoid();
    const now = new Date().toISOString();
    await db.collection("peerRequests").doc(requestId).set({
      requesterId: req.userId,
      recipientEmail: normalizedEmail,
      status: "pending",
      createdAt: now,
      updatedAt: now
    });

    const roleModel = await getCurrentRoleModel(req.user);
    try {
      const invite = await sendInviteEmail({
        to: normalizedEmail,
        inviterName: req.user.displayName || req.user.email,
        roleModelName: roleModel?.name || "a role model"
      });
      return res.json({ status: "invited", delivery: invite?.status || "sent" });
    } catch (error) {
      console.error("Invite email failed", error);
      return res.status(502).json({ error: "Invite email failed" });
    }
  }

  const recipientId = recipientSnap.docs[0].id;
  if (recipientId === req.userId) {
    return res.status(400).json({ error: "Cannot add yourself" });
  }

  const existingPeer = await db
    .collection("peers")
    .where("userId", "==", req.userId)
    .where("peerId", "==", recipientId)
    .limit(1)
    .get();
  if (!existingPeer.empty) {
    return res.status(409).json({ error: "Already connected" });
  }

  const existingRequest = await db
    .collection("peerRequests")
    .where("requesterId", "==", req.userId)
    .where("recipientId", "==", recipientId)
    .limit(1)
    .get();
  if (!existingRequest.empty) {
    return res.status(409).json({ error: "Already requested" });
  }

  const existingInviteByEmail = await db
    .collection("peerRequests")
    .where("requesterId", "==", req.userId)
    .where("recipientEmail", "==", normalizedEmail)
    .limit(1)
    .get();

  if (!existingInviteByEmail.empty) {
    const now = new Date().toISOString();
    await db.collection("peerRequests").doc(existingInviteByEmail.docs[0].id).update({
      recipientId,
      updatedAt: now
    });
    return res.json({ status: "sent" });
  }

  const requestId = nanoid();
  const now = new Date().toISOString();
  await db.collection("peerRequests").doc(requestId).set({
    requesterId: req.userId,
    recipientId,
    recipientEmail: normalizedEmail,
    status: "pending",
    createdAt: now,
    updatedAt: now
  });

  res.json({ status: "sent" });
});

app.post("/api/social/requests/:id/accept", requireAuth, async (req, res) => {
  const requestId = req.params.id;
  const requestSnap = await db.collection("peerRequests").doc(requestId).get();
  if (!requestSnap.exists || requestSnap.data().recipientId !== req.userId) {
    return res.status(404).json({ error: "Request not found" });
  }

  const now = new Date().toISOString();
  await db.collection("peerRequests").doc(requestId).update({
    status: "accepted",
    updatedAt: now
  });

  const requesterId = requestSnap.data().requesterId;
  await db.collection("peers").doc(nanoid()).set({
    userId: req.userId,
    peerId: requesterId,
    createdAt: now
  });
  await db.collection("peers").doc(nanoid()).set({
    userId: requesterId,
    peerId: req.userId,
    createdAt: now
  });

  res.json({ status: "accepted" });
});

app.post("/api/social/requests/:id/decline", requireAuth, async (req, res) => {
  const requestId = req.params.id;
  const requestSnap = await db.collection("peerRequests").doc(requestId).get();
  if (!requestSnap.exists || requestSnap.data().recipientId !== req.userId) {
    return res.status(404).json({ error: "Request not found" });
  }

  await db.collection("peerRequests").doc(requestId).update({
    status: "declined",
    updatedAt: new Date().toISOString()
  });

  res.json({ status: "declined" });
});

app.get("/api/social/timeline", requireAuth, async (req, res) => {
  const query = (req.query.q || "").toString().toLowerCase();
  const peerRows = await db
    .collection("peers")
    .where("userId", "==", req.userId)
    .get();

  const entries = [];
  for (const doc of peerRows.docs) {
    const peerId = doc.data().peerId;
    const peerDoc = await db.collection("users").doc(peerId).get();
    const peer = peerDoc.data();
    let roleModelName = "";
    let bioText = "";
    let latestDigestSummary = "";
    let latestDigestWeek = "";

    if (peer?.currentRoleModelId) {
      const roleDoc = await db.collection("roleModels").doc(peer.currentRoleModelId).get();
      const role = roleDoc.data();
      roleModelName = role?.name || "";
      bioText = role?.bioText || "";

      const digestSnap = await db
        .collection("digests")
        .where("roleModelId", "==", peer.currentRoleModelId)
        .orderBy("weekStart", "desc")
        .limit(1)
        .get();
      if (!digestSnap.empty) {
        const digest = digestSnap.docs[0].data();
        latestDigestSummary = digest.summaryText || "";
        latestDigestWeek = digest.weekStart || "";
      }
    }

    const entry = {
      id: nanoid(),
      peerName: peer?.displayName || "",
      roleModelName,
      bioText,
      latestDigestSummary,
      latestDigestWeek
    };

    const matchesQuery =
      !query ||
      entry.peerName.toLowerCase().includes(query) ||
      entry.roleModelName.toLowerCase().includes(query) ||
      entry.bioText.toLowerCase().includes(query) ||
      entry.latestDigestSummary.toLowerCase().includes(query);

    if (matchesQuery) {
      entries.push(entry);
    }
  }

  res.json({ entries });
});

export const api = onRequest(app);

export const weeklyDigests = onSchedule(
  {
    schedule: "0 8 * * 1",
    timeZone: process.env.CRON_TIMEZONE || "America/Los_Angeles"
  },
  async () => {
    const roleModelsSnap = await db
      .collection("roleModels")
      .where("isActive", "==", true)
      .get();

    for (const doc of roleModelsSnap.docs) {
      const roleModel = doc.data();
      if (!roleModel?.userId) continue;
      const userDoc = await db.collection("users").doc(roleModel.userId).get();
      const user = userDoc.data();
      if (!user) continue;
      await generateWeeklyDigest(db, {
        user: { ...user, id: userDoc.id },
        roleModel: { id: doc.id, name: roleModel.name },
        force: false
      });
    }
  }
);
