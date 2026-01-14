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
    photoURL: user.photoURL || "",
    weeklyEmailOptIn: !!user.weeklyEmailOptIn,
    zenMode: !!user.zenMode,
    timezone: user.timezone,
    currentRoleModelId: user.currentRoleModelId || null
  };
}

function isAdminUser(user) {
  const adminEmail =
    (process.env.ADMIN_EMAIL || "dalmomendonca@gmail.com").toLowerCase();
  const email = `${user?.email || ""}`.toLowerCase();
  return email === adminEmail;
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
  const photoURL = decoded.picture || decoded.photoURL || "";
  if (!snapshot.exists) {
    const payload = {
      id: decoded.uid,
      email: normalizedEmail,
      displayName: decoded.name || fallbackName,
      photoURL,
      weeklyEmailOptIn: true,
      zenMode: false,
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
  if (photoURL && data.photoURL !== photoURL) {
    updates.photoURL = photoURL;
  }
  if (typeof data.weeklyEmailOptIn !== "boolean") {
    updates.weeklyEmailOptIn = true;
  }
  if (typeof data.zenMode !== "boolean") {
    updates.zenMode = false;
  }
  if (Object.keys(updates).length) {
    await userRef.update(updates);
  }
  await attachPendingPeerRequests(decoded.uid, normalizedEmail);
  return { ...data, ...updates, id: decoded.uid };
}

async function ensureUserDocFromAuth(userRecord, normalizedEmail) {
  if (!userRecord?.uid || !normalizedEmail) return null;
  const userRef = db.collection("users").doc(userRecord.uid);
  const snapshot = await userRef.get();
  const fallbackName = normalizedEmail ? normalizedEmail.split("@")[0] : "User";
  const photoURL = userRecord.photoURL || "";
  if (!snapshot.exists) {
    const payload = {
      id: userRecord.uid,
      email: normalizedEmail,
      displayName: userRecord.displayName || fallbackName,
      photoURL,
      weeklyEmailOptIn: true,
      zenMode: false,
      timezone: "America/Los_Angeles",
      currentRoleModelId: null,
      createdAt: new Date().toISOString()
    };
    await userRef.set(payload);
    await attachPendingPeerRequests(userRecord.uid, normalizedEmail);
    return payload;
  }

  const data = snapshot.data();
  const updates = {};
  if (!data.displayName && (userRecord.displayName || fallbackName)) {
    updates.displayName = userRecord.displayName || fallbackName;
  }
  if (normalizedEmail && data.email !== normalizedEmail) {
    updates.email = normalizedEmail;
  }
  if (photoURL && data.photoURL !== photoURL) {
    updates.photoURL = photoURL;
  }
  if (typeof data.weeklyEmailOptIn !== "boolean") {
    updates.weeklyEmailOptIn = true;
  }
  if (typeof data.zenMode !== "boolean") {
    updates.zenMode = false;
  }
  if (Object.keys(updates).length) {
    await userRef.update(updates);
  }
  await attachPendingPeerRequests(userRecord.uid, normalizedEmail);
  return { ...data, ...updates, id: userRecord.uid };
}

async function shouldDeliverNotifications(userId) {
  if (!userId) return false;
  const doc = await db.collection("users").doc(userId).get();
  if (!doc.exists) return true;
  const data = doc.data() || {};
  return !data.zenMode;
}

async function createNotification(payload) {
  if (!payload?.userId) return null;
  const allow = await shouldDeliverNotifications(payload.userId);
  if (!allow) return null;
  const id = payload.id || nanoid();
  const createdAt = payload.createdAt || new Date().toISOString();
  await db
    .collection("users")
    .doc(payload.userId)
    .collection("notifications")
    .doc(id)
    .set(
      {
        id,
        type: payload.type || "unknown",
        createdAt,
        readAt: payload.readAt ?? null,
        actorUserId: payload.actorUserId || "",
        actorName: payload.actorName || "",
        actorPhotoURL: payload.actorPhotoURL || "",
        roleModelId: payload.roleModelId || "",
        roleModelName: payload.roleModelName || "",
        digestId: payload.digestId || "",
        commentId: payload.commentId || "",
        message: payload.message || ""
      },
      { merge: true }
    );
  return id;
}

async function getDigestOwner(digestId) {
  if (!digestId) return null;
  const digestDoc = await db.collection("digests").doc(digestId).get();
  if (!digestDoc.exists) return null;
  const digest = digestDoc.data() || {};
  if (!digest.roleModelId) return null;
  const roleDoc = await db.collection("roleModels").doc(digest.roleModelId).get();
  const role = roleDoc.exists ? roleDoc.data() || {} : {};
  return {
    roleModelId: digest.roleModelId,
    roleModelName: role.name || "",
    ownerUserId: role.userId || ""
  };
}

async function notifyPeersOfNewDigest({ ownerUserId, roleModelId, roleModelName, digestId, createdAt }) {
  if (!ownerUserId || !digestId) return;
  const peerSnap = await db
    .collection("peers")
    .where("userId", "==", ownerUserId)
    .get();
  if (peerSnap.empty) return;

  const ownerDoc = await db.collection("users").doc(ownerUserId).get();
  const owner = ownerDoc.exists ? ownerDoc.data() || {} : {};

  for (const doc of peerSnap.docs) {
    const peerId = doc.data()?.peerId;
    if (!peerId || peerId === ownerUserId) continue;
    const notificationId = `new_digest_${digestId}_${ownerUserId}`;
    await createNotification({
      id: notificationId,
      userId: peerId,
      type: "new_digest",
      createdAt: createdAt || new Date().toISOString(),
      actorUserId: ownerUserId,
      actorName: owner.displayName || owner.email || "",
      actorPhotoURL: owner.photoURL || "",
      roleModelId: roleModelId || "",
      roleModelName: roleModelName || "",
      digestId,
      message: `${owner.displayName || "Someone"} posted a new digest.`
    });
  }
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

async function ensurePeerConnection(userId, peerId) {
  if (!userId || !peerId) return;
  const existing = await db
    .collection("peers")
    .where("userId", "==", userId)
    .where("peerId", "==", peerId)
    .limit(1)
    .get();
  if (!existing.empty) return;
  await db.collection("peers").doc(nanoid()).set({
    userId,
    peerId,
    createdAt: new Date().toISOString()
  });
}

async function acceptPeerRequest(requestId) {
  const requestRef = db.collection("peerRequests").doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    return { ok: false, status: 404, error: "Request not found" };
  }
  const data = requestSnap.data();
  if (!data?.requesterId || !data?.recipientId) {
    return { ok: false, status: 400, error: "Request invalid" };
  }

  const now = new Date().toISOString();
  if (data.status !== "accepted") {
    await requestRef.update({
      status: "accepted",
      updatedAt: now
    });
  }

  await ensurePeerConnection(data.recipientId, data.requesterId);
  await ensurePeerConnection(data.requesterId, data.recipientId);

  return { ok: true, status: 200, payload: { status: "accepted" } };
}

async function declinePeerRequest(requestId) {
  const requestRef = db.collection("peerRequests").doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    return { ok: false, status: 404, error: "Request not found" };
  }
  const now = new Date().toISOString();
  await requestRef.update({
    status: "declined",
    updatedAt: now
  });
  return { ok: true, status: 200, payload: { status: "declined" } };
}

const reactionTypes = [
  "like",
  "love",
  "laugh",
  "wow",
  "insightful",
  "spicy",
  "charged",
  "star"
];

function normalizeReactionType(type) {
  const normalized = `${type || ""}`.toLowerCase().trim();
  return reactionTypes.includes(normalized) ? normalized : null;
}

async function getReactionSummary(digestId, viewerId) {
  const reactionSnap = await db
    .collection("digestReactions")
    .where("digestId", "==", digestId)
    .get();

  const counts = {};
  let viewerReaction = null;
  reactionSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (!data?.type) return;
    counts[data.type] = (counts[data.type] || 0) + 1;
    if (data.userId === viewerId) {
      viewerReaction = data.type;
    }
  });

  return { counts, viewerReaction };
}

async function getDigestCommentsThread(digestId) {
  const commentSnap = await db
    .collection("digestComments")
    .where("digestId", "==", digestId)
    .get();

  if (commentSnap.empty) {
    return [];
  }

  const comments = commentSnap.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data()
    }))
    .sort((a, b) =>
      `${a.createdAt || ""}`.localeCompare(b.createdAt || "")
    );
  const userIds = [
    ...new Set(comments.map((comment) => comment.userId).filter(Boolean))
  ];
  const userDocs = await Promise.all(
    userIds.map((userId) => db.collection("users").doc(userId).get())
  );
  const userMap = new Map(
    userDocs.map((doc) => [doc.id, doc.data() || {}])
  );

  const nodes = comments.map((comment) => ({
    id: comment.id,
    text: comment.text || "",
    createdAt: comment.createdAt || "",
    parentId: comment.parentId || null,
    user: {
      id: comment.userId || "",
      displayName: userMap.get(comment.userId)?.displayName || "",
      photoURL: userMap.get(comment.userId)?.photoURL || ""
    },
    replies: []
  }));

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const roots = [];

  nodes.forEach((node) => {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId).replies.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
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
    const result = await generateWeeklyDigest(db, {
      user: req.user,
      roleModel,
      force: true
    });

    if (result?.wasCreated) {
      await notifyPeersOfNewDigest({
        ownerUserId: req.userId,
        roleModelId: roleModel.id,
        roleModelName: roleModel.name,
        digestId: result.digestId,
        createdAt: new Date().toISOString()
      });
    }

    res.json({ digests: result?.digests || [] });
  } catch (error) {
    console.error("Digest generation failed", error);
    const detail = typeof error?.message === "string" ? error.message : "";
    const message = detail
      ? `Digest generation failed: ${detail}`
      : "Digest generation failed";
    res.status(502).json({ error: message });
  }
});

app.get("/api/social/role-models/:id", requireAuth, async (req, res) => {
  const doc = await db.collection("roleModels").doc(req.params.id).get();
  if (!doc.exists) {
    return res.status(404).json({ error: "Role model not found" });
  }
  const roleModel = mapRoleModel(doc);
  return res.json({ roleModel });
});

app.get("/api/digests/share/:id", async (req, res) => {
  const digest = await getPublicDigest(db, req.params.id);
  if (!digest) {
    return res.status(404).json({ error: "Digest not found" });
  }
  res.json({ digest });
});

app.patch("/api/preferences", requireAuth, async (req, res) => {
  const { weeklyEmailOptIn, timezone, zenMode } = req.body || {};
  const updates = {
    weeklyEmailOptIn: !!weeklyEmailOptIn,
    timezone: timezone || req.user.timezone || "America/Los_Angeles"
  };

  if (typeof zenMode === "boolean") {
    updates.zenMode = zenMode;
  }

  await db.collection("users").doc(req.userId).update(updates);
  const updated = await db.collection("users").doc(req.userId).get();
  res.json({ user: toPublicUser({ ...updated.data(), id: updated.id }) });
});

app.get("/api/admin/overview", requireAuth, async (req, res) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const [
    userSnap,
    roleModelSnap,
    digestSnap,
    peerSnap,
    requestSnap
  ] = await Promise.all([
    db.collection("users").get(),
    db.collection("roleModels").get(),
    db.collection("digests").get(),
    db.collection("peers").get(),
    db.collection("peerRequests").get()
  ]);

  const users = userSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const userMap = new Map(users.map((user) => [user.id, user]));

  const roleModels = roleModelSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
  const rolesByUserId = new Map();
  roleModels.forEach((role) => {
    if (!role?.userId) return;
    if (!rolesByUserId.has(role.userId)) {
      rolesByUserId.set(role.userId, []);
    }
    rolesByUserId.get(role.userId).push({
      id: role.id,
      name: role.name || "",
      bioText: role.bioText || "",
      notesText: role.notesText || "",
      imageUrl: role.imageUrl || "",
      isActive: !!role.isActive,
      createdAt: role.createdAt || "",
      bioUpdatedAt: role.bioUpdatedAt || "",
      notesUpdatedAt: role.notesUpdatedAt || "",
      imageUpdatedAt: role.imageUpdatedAt || ""
    });
  });

  const digests = digestSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
  const digestsByRoleModelId = new Map();
  digests.forEach((digest) => {
    if (!digest?.roleModelId) return;
    if (!digestsByRoleModelId.has(digest.roleModelId)) {
      digestsByRoleModelId.set(digest.roleModelId, []);
    }
    const items = Array.isArray(digest.items) ? digest.items : [];
    digestsByRoleModelId.get(digest.roleModelId).push({
      id: digest.id,
      weekStart: digest.weekStart || "",
      summaryText: digest.summaryText || "",
      generatedAt: digest.generatedAt || "",
      items: items.map((item) => ({
        sourceTitle: item.sourceTitle || "",
        sourceUrl: item.sourceUrl || "",
        sourceType: item.sourceType || "",
        sourceDate: item.sourceDate || "",
        summary: item.summary || ""
      }))
    });
  });

  const peers = peerSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const peersByUserId = new Map();
  const connectionPairs = new Set();
  peers.forEach((peer) => {
    if (!peer?.userId || !peer?.peerId) return;
    if (!peersByUserId.has(peer.userId)) {
      peersByUserId.set(peer.userId, []);
    }
    peersByUserId.get(peer.userId).push(peer.peerId);
    const pairKey = [peer.userId, peer.peerId].sort().join("|");
    connectionPairs.add(pairKey);
  });

  const requests = requestSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
  const requestsByRequester = new Map();
  const requestsByRecipient = new Map();
  requests.forEach((request) => {
    if (request.requesterId) {
      if (!requestsByRequester.has(request.requesterId)) {
        requestsByRequester.set(request.requesterId, []);
      }
      requestsByRequester.get(request.requesterId).push(request);
    }
    if (request.recipientId) {
      if (!requestsByRecipient.has(request.recipientId)) {
        requestsByRecipient.set(request.recipientId, []);
      }
      requestsByRecipient.get(request.recipientId).push(request);
    }
  });

  const adminUsers = users.map((user) => {
    const userRoles = rolesByUserId.get(user.id) || [];
    const roleModelIds = userRoles.map((role) => role.id);
    const roleModelsWithDigests = userRoles.map((role) => {
      const roleDigests = (digestsByRoleModelId.get(role.id) || []).slice();
      roleDigests.sort((a, b) =>
        `${b.weekStart || ""}`.localeCompare(a.weekStart || "")
      );
      return {
        ...role,
        digests: roleDigests
      };
    });

    const allDigests = roleModelIds.flatMap(
      (roleId) => digestsByRoleModelId.get(roleId) || []
    );
    allDigests.sort((a, b) => `${b.weekStart || ""}`.localeCompare(a.weekStart || ""));

    const peerIds = peersByUserId.get(user.id) || [];
    const peerEntries = peerIds.map((peerId) => {
      const peer = userMap.get(peerId);
      return {
        id: peerId,
        displayName: peer?.displayName || "",
        email: peer?.email || ""
      };
    });

    const outgoing = (requestsByRequester.get(user.id) || []).map((req) => {
      const recipient = req.recipientId ? userMap.get(req.recipientId) : null;
      return {
        id: req.id,
        status: req.status || "pending",
        createdAt: req.createdAt || "",
        recipientName: recipient?.displayName || "",
        recipientEmail: recipient?.email || req.recipientEmail || ""
      };
    });

    const incoming = (requestsByRecipient.get(user.id) || []).map((req) => {
      const requester = req.requesterId ? userMap.get(req.requesterId) : null;
      return {
        id: req.id,
        status: req.status || "pending",
        createdAt: req.createdAt || "",
        requesterName: requester?.displayName || "",
        requesterEmail: requester?.email || ""
      };
    });

    return {
      id: user.id,
      email: user.email || "",
      displayName: user.displayName || "",
      weeklyEmailOptIn: !!user.weeklyEmailOptIn,
      zenMode: !!user.zenMode,
      timezone: user.timezone || "",
      createdAt: user.createdAt || "",
      currentRoleModelId: user.currentRoleModelId || "",
      roleModels: roleModelsWithDigests,
      digests: allDigests,
      peers: peerEntries,
      outgoingRequests: outgoing,
      incomingRequests: incoming
    };
  });

  const summary = {
    userCount: users.length,
    roleModelCount: roleModels.length,
    digestCount: digests.length,
    peerConnectionCount: connectionPairs.size,
    pendingRequestCount: requests.filter((req) => req.status === "pending").length
  };

  res.json({ summary, users: adminUsers });
});

app.post("/api/admin/requests/:id/accept", requireAuth, async (req, res) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await acceptPeerRequest(req.params.id);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json(result.payload);
});

app.post("/api/admin/requests/:id/decline", requireAuth, async (req, res) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await declinePeerRequest(req.params.id);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json(result.payload);
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
    let roleModelImageUrl = "";
    let roleModelId = "";
    if (peerUser?.currentRoleModelId) {
      const roleDoc = await db.collection("roleModels").doc(peerUser.currentRoleModelId).get();
      roleModelName = roleDoc.data()?.name || "";
      roleModelImageUrl = roleDoc.data()?.imageUrl || "";
      roleModelId = roleDoc.id;
    }
    peers.push({
      id: peerId,
      displayName: peerUser?.displayName || "",
      photoURL: peerUser?.photoURL || "",
      roleModelName,
      roleModelImageUrl,
      roleModelId
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

app.get("/api/social/users", requireAuth, async (req, res) => {
  const query = (req.query.q || "").toString().toLowerCase().trim();
  const [
    userSnap,
    roleModelSnap,
    peerSnap,
    outgoingSnap,
    incomingSnap
  ] = await Promise.all([
    db.collection("users").get(),
    db.collection("roleModels").where("isActive", "==", true).get(),
    db.collection("peers").where("userId", "==", req.userId).get(),
    db.collection("peerRequests").where("requesterId", "==", req.userId).get(),
    db.collection("peerRequests").where("recipientId", "==", req.userId).get()
  ]);

  const roleByUserId = new Map();
  roleModelSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (!data?.userId) return;
    roleByUserId.set(data.userId, {
      id: doc.id,
      name: data.name || "",
      imageUrl: data.imageUrl || ""
    });
  });

  const peerIds = new Set(peerSnap.docs.map((doc) => doc.data().peerId));
  const outgoingIds = new Set();
  const outgoingEmails = new Set();
  outgoingSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (data.status && data.status !== "pending") return;
    if (data.recipientId) {
      outgoingIds.add(data.recipientId);
    }
    if (data.recipientEmail) {
      outgoingEmails.add(`${data.recipientEmail}`.toLowerCase());
    }
  });

  const incomingIds = new Set();
  incomingSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (data.status && data.status !== "pending") return;
    if (data.requesterId) {
      incomingIds.add(data.requesterId);
    }
  });

  const users = userSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((user) => user.id !== req.userId)
    .map((user) => {
      const role = roleByUserId.get(user.id);
      let relation = "none";
      if (peerIds.has(user.id)) {
        relation = "connected";
      } else if (outgoingIds.has(user.id)) {
        relation = "outgoing";
      } else if (incomingIds.has(user.id)) {
        relation = "incoming";
      } else if (user.email && outgoingEmails.has(user.email.toLowerCase())) {
        relation = "outgoing";
      }
      return {
        id: user.id,
        displayName: user.displayName || "",
        email: user.email || "",
        photoURL: user.photoURL || "",
        roleModelId: role?.id || "",
        roleModelName: role?.name || "",
        roleModelImageUrl: role?.imageUrl || "",
        relation
      };
    })
    .filter((user) => {
      if (!query) return true;
      const haystack = [
        user.displayName,
        user.email,
        user.roleModelName
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => `${a.displayName}`.localeCompare(b.displayName));

  res.json({ users });
});

app.post("/api/social/requests", requireAuth, async (req, res) => {
  const { email, userId } = req.body || {};
  if (!email && !userId) {
    return res.status(400).json({ error: "Email or userId required" });
  }

  let normalizedEmail = email ? email.toLowerCase() : "";
  let recipientId = userId || null;

  if (recipientId && recipientId === req.userId) {
    return res.status(400).json({ error: "Cannot add yourself" });
  }

  if (normalizedEmail && normalizedEmail === req.user.email) {
    return res.status(400).json({ error: "Cannot add yourself" });
  }

  if (recipientId) {
    const recipientDoc = await db.collection("users").doc(recipientId).get();
    if (!recipientDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    const recipientData = recipientDoc.data();
    normalizedEmail = recipientData?.email || normalizedEmail;
  }

  if (!recipientId && normalizedEmail) {
    const recipientSnap = await db
      .collection("users")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    if (!recipientSnap.empty) {
      recipientId = recipientSnap.docs[0].id;
    } else {
      try {
        const authUser = await admin.auth().getUserByEmail(normalizedEmail);
        if (authUser?.uid) {
          recipientId = authUser.uid;
          await ensureUserDocFromAuth(authUser, normalizedEmail);
        }
      } catch (error) {
        if (error?.code !== "auth/user-not-found") {
          console.warn("Auth lookup failed", error);
        }
      }
    }
  }

  if (!recipientId) {
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
  const result = await acceptPeerRequest(requestId);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json(result.payload);
});

app.post("/api/social/requests/:id/decline", requireAuth, async (req, res) => {
  const requestId = req.params.id;
  const requestSnap = await db.collection("peerRequests").doc(requestId).get();
  if (!requestSnap.exists || requestSnap.data().recipientId !== req.userId) {
    return res.status(404).json({ error: "Request not found" });
  }
  const result = await declinePeerRequest(requestId);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json(result.payload);
});

app.get("/api/social/timeline", requireAuth, async (req, res) => {
  const query = (req.query.q || "").toString().toLowerCase().trim();
  const peerRows = await db
    .collection("peers")
    .where("userId", "==", req.userId)
    .get();

  const peerIds = peerRows.docs
    .map((doc) => doc.data().peerId)
    .filter(Boolean);
  const userIds = Array.from(new Set([req.userId, ...peerIds]));
  const userDocs = await Promise.all(
    userIds.map((userId) => db.collection("users").doc(userId).get())
  );
  const userMap = new Map(
    userDocs
      .filter((doc) => doc.exists)
      .map((doc) => [doc.id, doc.data()])
  );

  const entries = [];

  for (const userId of userIds) {
    const user = userMap.get(userId);
    if (!user) continue;

    const roleSnap = await db
      .collection("roleModels")
      .where("userId", "==", userId)
      .get();

    for (const roleDoc of roleSnap.docs) {
      const role = roleDoc.data();
      const digestSnap = await db
        .collection("digests")
        .where("roleModelId", "==", roleDoc.id)
        .get();

      for (const digestDoc of digestSnap.docs) {
        const digest = digestDoc.data();
        const summaryText = digest?.summaryText || "";
        const digestDateValue = digest?.generatedAt || digest?.weekStart || "";
        const digestDate = new Date(digestDateValue);
        const digestTimestamp = Number.isNaN(digestDate.getTime())
          ? 0
          : digestDate.getTime();

        const entry = {
          id: digestDoc.id,
          digestId: digestDoc.id,
          summaryText,
          weekStart: digest?.weekStart || "",
          generatedAt: digest?.generatedAt || "",
          itemCount: Array.isArray(digest?.items) ? digest.items.length : 0,
          peerId: userId,
          peerName: user?.displayName || "",
          peerPhotoURL: user?.photoURL || "",
          roleModelId: roleDoc.id,
          roleModelName: role?.name || "",
          roleModelImageUrl: role?.imageUrl || "",
          isSelf: userId === req.userId,
          digestTimestamp
        };

        const weekStartValue = `${entry.weekStart || ""}`.toLowerCase();
        const matchesQuery =
          !query ||
          entry.peerName.toLowerCase().includes(query) ||
          entry.roleModelName.toLowerCase().includes(query) ||
          summaryText.toLowerCase().includes(query) ||
          weekStartValue.includes(query);

        if (matchesQuery) {
          entries.push(entry);
        }
      }
    }
  }

  const entriesWithThreads = await Promise.all(
    entries.map(async (entry) => {
      const [reactions, comments] = await Promise.all([
        getReactionSummary(entry.digestId, req.userId),
        getDigestCommentsThread(entry.digestId)
      ]);
      return { ...entry, reactions, comments };
    })
  );

  entriesWithThreads.sort((a, b) => {
    const diff = (b.digestTimestamp || 0) - (a.digestTimestamp || 0);
    if (diff !== 0) return diff;
    return `${a.peerName}`.localeCompare(b.peerName);
  });

  res.json({ entries: entriesWithThreads });
});

app.get("/api/social/digests/:digestId/thread", requireAuth, async (req, res) => {
  const { digestId } = req.params;
  const [reactions, comments] = await Promise.all([
    getReactionSummary(digestId, req.userId),
    getDigestCommentsThread(digestId)
  ]);
  res.json({ reactions, comments });
});

app.post("/api/social/digests/:digestId/reactions", requireAuth, async (req, res) => {
  const { digestId } = req.params;
  const type = normalizeReactionType(req.body?.type);
  if (!type) {
    return res.status(400).json({ error: "Invalid reaction type" });
  }

  const docId = `${digestId}_${req.userId}`;
  const reactionRef = db.collection("digestReactions").doc(docId);
  const snapshot = await reactionRef.get();
  const now = new Date().toISOString();

  let shouldNotify = false;

  if (snapshot.exists) {
    const existing = snapshot.data();
    if (existing?.type === type) {
      await reactionRef.delete();
    } else {
      shouldNotify = true;
      await reactionRef.set(
        {
          digestId,
          userId: req.userId,
          type,
          createdAt: existing.createdAt || now,
          updatedAt: now
        },
        { merge: true }
      );
    }
  } else {
    shouldNotify = true;
    await reactionRef.set({
      digestId,
      userId: req.userId,
      type,
      createdAt: now,
      updatedAt: now
    });
  }

  if (shouldNotify) {
    const owner = await getDigestOwner(digestId);
    if (owner?.ownerUserId && owner.ownerUserId !== req.userId) {
      const notificationId = `reaction_${digestId}_${req.userId}`;
      await createNotification({
        id: notificationId,
        userId: owner.ownerUserId,
        type: "reaction",
        createdAt: now,
        actorUserId: req.userId,
        actorName: req.user.displayName || req.user.email || "",
        actorPhotoURL: req.user.photoURL || "",
        roleModelId: owner.roleModelId,
        roleModelName: owner.roleModelName,
        digestId,
        message: `${req.user.displayName || "Someone"} reacted to your digest.`
      });
    }
  }

  const reactions = await getReactionSummary(digestId, req.userId);
  res.json(reactions);
});

app.post("/api/social/digests/:digestId/comments", requireAuth, async (req, res) => {
  const { digestId } = req.params;
  const text = `${req.body?.text || ""}`.trim();
  const parentId = req.body?.parentId || null;
  if (!text) {
    return res.status(400).json({ error: "Comment required" });
  }

  const commentId = nanoid();
  const now = new Date().toISOString();
  await db.collection("digestComments").doc(commentId).set({
    id: commentId,
    digestId,
    userId: req.userId,
    text,
    parentId,
    createdAt: now
  });

  const owner = await getDigestOwner(digestId);
  if (owner?.ownerUserId && owner.ownerUserId !== req.userId) {
    await createNotification({
      id: `comment_${commentId}`,
      userId: owner.ownerUserId,
      type: parentId ? "reply" : "comment",
      createdAt: now,
      actorUserId: req.userId,
      actorName: req.user.displayName || req.user.email || "",
      actorPhotoURL: req.user.photoURL || "",
      roleModelId: owner.roleModelId,
      roleModelName: owner.roleModelName,
      digestId,
      commentId,
      message: parentId
        ? `${req.user.displayName || "Someone"} replied on your digest.`
        : `${req.user.displayName || "Someone"} commented on your digest.`
    });
  }

  if (parentId) {
    const parentSnap = await db.collection("digestComments").doc(parentId).get();
    const parent = parentSnap.exists ? parentSnap.data() || {} : {};
    const parentUserId = parent.userId || "";
    if (parentUserId && parentUserId !== req.userId && parentUserId !== owner?.ownerUserId) {
      await createNotification({
        id: `reply_${commentId}`,
        userId: parentUserId,
        type: "reply",
        createdAt: now,
        actorUserId: req.userId,
        actorName: req.user.displayName || req.user.email || "",
        actorPhotoURL: req.user.photoURL || "",
        roleModelId: owner?.roleModelId || "",
        roleModelName: owner?.roleModelName || "",
        digestId,
        commentId,
        message: `${req.user.displayName || "Someone"} replied to your comment.`
      });
    }
  }

  const comments = await getDigestCommentsThread(digestId);
  res.json({ comments });
});

app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
  const snapshot = await db
    .collection("users")
    .doc(req.userId)
    .collection("notifications")
    .where("readAt", "==", null)
    .get();
  res.json({ unreadCount: snapshot.size || 0 });
});

app.get("/api/notifications", requireAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 30));
  const snapshot = await db
    .collection("users")
    .doc(req.userId)
    .collection("notifications")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const notifications = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const unreadCount = notifications.filter((n) => !n.readAt).length;
  res.json({ notifications, unreadCount });
});

app.get("/api/social/role-models/:id", async (req, res) => {
  const { id } = req.params;
  console.log("Role model bio request for ID:", id);
  
  if (!id) {
    return res.status(400).json({ error: "Role model ID required" });
  }

  const roleDoc = await db.collection("roleModels").doc(id).get();
  console.log("Role model doc exists:", roleDoc.exists);
  
  if (!roleDoc.exists) {
    return res.status(404).json({ error: "Role model not found" });
  }

  const roleModel = { id: roleDoc.id, ...roleDoc.data() };
  console.log("Role model data:", { id: roleModel.id, name: roleModel.name });
  
  // Get bio for this role model
  const bioSnap = await db
    .collection("bios")
    .where("roleModelId", "==", id)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  let bio = null;
  if (!bioSnap.empty) {
    bio = { id: bioSnap.docs[0].id, ...bioSnap.docs[0].data() };
    console.log("Bio found:", bio.id);
  } else {
    console.log("No bio found for role model");
  }

  res.json({ roleModel, bio });
});

app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  const snapshot = await db
    .collection("users")
    .doc(req.userId)
    .collection("notifications")
    .where("readAt", "==", null)
    .get();
  if (snapshot.empty) {
    return res.json({ status: "ok" });
  }
  const batch = db.batch();
  const now = new Date().toISOString();
  snapshot.docs.forEach((doc) => {
    batch.update(doc.ref, { readAt: now });
  });
  await batch.commit();
  return res.json({ status: "ok" });
});

app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
  const notificationRef = db
    .collection("users")
    .doc(req.userId)
    .collection("notifications")
    .doc(req.params.id);
  const doc = await notificationRef.get();
  if (!doc.exists) {
    return res.status(404).json({ error: "Notification not found" });
  }
  await notificationRef.update({ readAt: new Date().toISOString() });
  return res.json({ status: "ok" });
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
      const result = await generateWeeklyDigest(db, {
        user: { ...user, id: userDoc.id },
        roleModel: { id: doc.id, name: roleModel.name },
        force: false
      });

      if (result?.wasCreated) {
        await notifyPeersOfNewDigest({
          ownerUserId: roleModel.userId,
          roleModelId: doc.id,
          roleModelName: roleModel.name,
          digestId: result.digestId,
          createdAt: new Date().toISOString()
        });
      }
    }
  }
);
