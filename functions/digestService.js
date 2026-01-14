import crypto from "crypto";
import { nanoid } from "nanoid";
import { collectSources, fetchOfficialProfiles } from "./agents/sourceAgent.js";
import { generateDigest } from "./agents/digestAgent.js";
import { summarizeDigestItems } from "./agents/itemSummaryAgent.js";
import { generateDigestSummary } from "./agents/digestSummaryAgent.js";
import { sendDigestEmail } from "./email.js";
import { getWeekStart, toIsoDate } from "./utils/date.js";

function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function isOfficialSocialUrl(url, profiles) {
  const lowerUrl = (url || "").toLowerCase();
  const twitter = (profiles.twitter || "").toLowerCase();
  const instagram = (profiles.instagram || "").toLowerCase();
  const facebook = (profiles.facebook || "").toLowerCase();
  const linkedin = (profiles.linkedin || "").toLowerCase();

  if (twitter) {
    if (lowerUrl.includes(`twitter.com/${twitter}`) || lowerUrl.includes(`x.com/${twitter}`)) {
      return true;
    }
  }
  if (instagram && lowerUrl.includes(`instagram.com/${instagram}`)) {
    return true;
  }
  if (facebook && lowerUrl.includes(`facebook.com/${facebook}`)) {
    return true;
  }
  if (linkedin && lowerUrl.includes(`linkedin.com/${linkedin}`)) {
    return true;
  }
  return false;
}

function isOfficialVideoUrl(url, profiles) {
  const lowerUrl = (url || "").toLowerCase();
  const channelId = (profiles.youtubeChannelId || "").toLowerCase();
  const username = (profiles.youtubeUsername || "").toLowerCase();

  if (channelId && lowerUrl.includes(`channel/${channelId}`)) {
    return true;
  }
  if (username && (lowerUrl.includes(`/@${username}`) || lowerUrl.includes(`/user/${username}`))) {
    return true;
  }
  return false;
}

function getClientOrigin() {
  const origin =
    process.env.CLIENT_ORIGIN ||
    process.env.CORS_ORIGIN ||
    "http://localhost:5173";
  return origin.replace(/\/$/, "");
}

function buildDigestShareUrl(origin, digestId) {
  if (!digestId) return origin;
  return `${origin}/digest/share/${digestId}`;
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEmailDate(isoDate) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function normalizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    return url;
  }
}

function isVideoUrl(url) {
  const lowerUrl = (url || "").toLowerCase();
  return (
    lowerUrl.includes("youtube.com/watch") ||
    lowerUrl.includes("youtube.com/shorts/") ||
    lowerUrl.includes("youtube.com/live/") ||
    lowerUrl.includes("youtube.com/embed/") ||
    lowerUrl.includes("youtu.be/")
  );
}

function getItemKey(item) {
  const normalized = normalizeUrl(item.sourceUrl);
  if (normalized) return `url:${normalized}`;
  if (item.id) return `id:${item.id}`;
  const title = item.sourceTitle || "";
  const summary = item.summary || "";
  return `text:${title}|${summary}`.toLowerCase();
}

export async function getDigestsForRoleModel(db, roleModelId, limit = 6) {
  if (!roleModelId) {
    return [];
  }
  const snapshot = await db
    .collection("digests")
    .where("roleModelId", "==", roleModelId)
    .get();

  const digests = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      weekStart: data.weekStart,
      summaryText: data.summaryText,
      topics: Array.isArray(data.topics) ? data.topics : [],
      takeaways: Array.isArray(data.takeaways) ? data.takeaways : [],
      generatedAt: data.generatedAt,
      items: Array.isArray(data.items) ? data.items : []
    };
  });

  digests.sort((a, b) => `${b.weekStart || ""}`.localeCompare(a.weekStart || ""));
  return digests.slice(0, limit);
}

export async function getPublicDigest(db, digestId) {
  const digestDoc = await db.collection("digests").doc(digestId).get();
  if (!digestDoc.exists) return null;
  const digest = digestDoc.data();
  const roleDoc = await db.collection("roleModels").doc(digest.roleModelId).get();
  const role = roleDoc.exists ? roleDoc.data() : {};

  return {
    id: digestDoc.id,
    weekStart: digest.weekStart,
    summaryText: digest.summaryText,
    generatedAt: digest.generatedAt,
    roleModelName: role?.name || "",
    roleModelImage: role?.imageUrl || "",
    items: Array.isArray(digest.items) ? digest.items : []
  };
}

export async function generateWeeklyDigest(db, { user, roleModel, force = false }) {
  const weekStartDate = getWeekStart(new Date());
  const weekStart = toIsoDate(weekStartDate);

  const existingSnap = await db
    .collection("digests")
    .where("roleModelId", "==", roleModel.id)
    .get();
  const existingDocs = existingSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
  const existingDoc = existingDocs.find((doc) => doc.weekStart === weekStart) || null;
  const wasCreated = !existingDoc;

  if (existingDoc && !force) {
    return {
      digests: await getDigestsForRoleModel(db, roleModel.id),
      digestId: existingDoc.id,
      weekStart,
      wasCreated: false
    };
  }

  const customSourceSnap = await db
    .collection("roleModels")
    .doc(roleModel.id)
    .collection("sources")
    .get();
  const customSources = customSourceSnap.docs.map((doc) => doc.data());

  const sortedPrevious = existingDocs
    .slice()
    .sort((a, b) => `${b.weekStart || ""}`.localeCompare(a.weekStart || ""))
    .slice(0, 6);
  const previousKeys = [];
  sortedPrevious.forEach((doc) => {
    const items = Array.isArray(doc.items) ? doc.items : [];
    items.forEach((item) => {
      previousKeys.push(
        `${item.sourceUrl || ""}|${item.sourceTitle || ""}`.toLowerCase()
      );
    });
  });

  const candidates = await collectSources({
    roleModelName: roleModel.name,
    weekStart: weekStartDate,
    customSources
  });

  const digest = await generateDigest({
    roleModelName: roleModel.name,
    weekStart: weekStartDate,
    candidates,
    previousKeys
  });

  try {
    digest.items = await summarizeDigestItems(digest.items || [], roleModel.name);
  } catch (error) {
    console.warn("Digest item summarization failed", error);
  }

  try {
    const summaryText = await generateDigestSummary({
      roleModelName: roleModel.name,
      items: digest.items || []
    });
    if (summaryText) {
      digest.summaryText = summaryText;
    }
  } catch (error) {
    console.warn("Digest summary generation failed", error);
  }

  const officialProfiles = await fetchOfficialProfiles(roleModel.name);
  digest.items = (digest.items || []).map((item) => ({
    ...item,
    id: item.id || nanoid(),
    isOfficial:
      item.isOfficial ||
      isOfficialSocialUrl(item.sourceUrl, officialProfiles) ||
      isOfficialVideoUrl(item.sourceUrl, officialProfiles)
  }));

  const seenUrls = new Set();
  const cleanedItems = [];
  for (const item of digest.items || []) {
    const normalizedUrl = (item.sourceUrl || "").trim();
    const key = normalizedUrl.toLowerCase();
    if (key && seenUrls.has(key)) continue;
    if (key) seenUrls.add(key);
    cleanedItems.push({
      ...item,
      sourceUrl: normalizedUrl || null,
      sourceTitle: item.sourceTitle || "",
      sourceType: item.sourceType || "web",
      sourceDate: item.sourceDate || "",
      summary: item.summary || "Update captured from the weekly scan.",
      contentHash: item.contentHash || hashContent(`${item.sourceTitle}|${item.summary}`)
    });
  }

  const digestId = existingDoc ? existingDoc.id : nanoid();
  const digestPayload = {
    id: digestId,
    roleModelId: roleModel.id,
    weekStart,
    summaryText: digest.summaryText || "",
    topics: Array.isArray(digest.topics) ? digest.topics : [],
    takeaways: Array.isArray(digest.takeaways) ? digest.takeaways : [],
    generatedAt: new Date().toISOString(),
    items: cleanedItems
  };

  await db.collection("digests").doc(digestId).set(digestPayload, { merge: true });

  if (user.weeklyEmailOptIn) {
    const clientOrigin = getClientOrigin();
    const digestUrl = buildDigestShareUrl(clientOrigin, digestId);
    const socialUrl = `${clientOrigin}/social`;
    const html = buildDigestEmailHtml(roleModel.name, digestPayload, {
      digestUrl,
      socialUrl,
      weekStart
    });
    const subject = `Your ${roleModel.name} digest for the week of ${weekStart}`;
    const text = buildDigestEmailText(roleModel.name, digestPayload, {
      digestUrl,
      socialUrl,
      weekStart
    });

    try {
      await sendDigestEmail({
        to: user.email,
        subject,
        html,
        text
      });
      await db.collection("digests").doc(digestId).update({
        emailSentAt: new Date().toISOString()
      });
    } catch (error) {
      // Swallow email failures to keep digest creation intact.
    }
  }

  return {
    digests: await getDigestsForRoleModel(db, roleModel.id),
    digestId,
    weekStart,
    wasCreated
  };
}

function buildDigestEmailHtml(roleModelName, digest, options) {
  const safeName = escapeHtml(roleModelName || "Role Model");
  const summary = escapeHtml(digest.summaryText || "");
  const weekLabel = formatEmailDate(options.weekStart);
  const digestUrl = options.digestUrl || "";
  const socialUrl = options.socialUrl || "";
  const items = Array.isArray(digest.items) ? digest.items : [];
  const typeOrder = ["video", "social", "news", "web", "custom"];
  const typeLabels = {
    video: "Video",
    social: "Social",
    news: "News",
    web: "Web",
    custom: "Custom"
  };
  const actionLabels = {
    video: "Watch",
    social: "View post",
    news: "Read",
    web: "Read",
    custom: "Open"
  };

  const videoItem = items.find(
    (item) => item.sourceType === "video" || isVideoUrl(item.sourceUrl)
  );
  const spotlightKey = videoItem ? getItemKey(videoItem) : "";
  const listItems = items.filter((item) => getItemKey(item) !== spotlightKey);
  const grouped = listItems.reduce((acc, item) => {
    const type =
      item.sourceType === "video" || isVideoUrl(item.sourceUrl)
        ? "video"
        : item.sourceType || "web";
    if (!acc[type]) acc[type] = [];
    acc[type].push(item);
    return acc;
  }, {});

  const buildItemHtml = (item, type) => {
    const title = escapeHtml(item.sourceTitle || "Update");
    const itemSummary = escapeHtml(item.summary || "");
    const itemUrl = normalizeUrl(item.sourceUrl);
    const date = item.sourceDate ? escapeHtml(item.sourceDate) : "";
    const official = item.isOfficial ? "Official" : "";
    const meta = [date, official].filter(Boolean).join(" | ");
    const action = actionLabels[type] || "Open";
    const link = itemUrl
      ? `<a href="${itemUrl}" style="color:#ff6b2d;text-decoration:none;">${action}</a>`
      : "";
    return `
      <div style="padding:12px 0;border-bottom:1px solid #eee5d9;">
        ${meta ? `<div style="font-size:12px;letter-spacing:1px;color:#8c7b6b;text-transform:uppercase;margin-bottom:6px;">${meta}</div>` : ""}
        <div style="font-size:16px;font-weight:600;margin-bottom:6px;">${title}</div>
        ${itemSummary ? `<div style="font-size:14px;line-height:1.6;color:#3d3a35;margin-bottom:8px;">${itemSummary}</div>` : ""}
        ${link}
      </div>
    `;
  };

  const sectionsHtml = typeOrder
    .map((type) => {
      const sectionItems = grouped[type] || [];
      if (!sectionItems.length) return "";
      const sectionTitle = typeLabels[type] || type;
      return `
        <div style="margin-top:24px;">
          <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#6c5a4d;margin-bottom:8px;">${sectionTitle}</div>
          ${sectionItems.map((item) => buildItemHtml(item, type)).join("")}
        </div>
      `;
    })
    .join("");

  const videoHtml = videoItem
    ? `
      <div style="margin-top:20px;padding:16px;border-radius:16px;background:#fff3e6;border:1px solid #f2d8c2;">
        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6c5a4d;margin-bottom:6px;">Video spotlight</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:6px;">${escapeHtml(
          videoItem.sourceTitle || "Video"
        )}</div>
        <div style="font-size:14px;line-height:1.6;color:#3d3a35;margin-bottom:10px;">${escapeHtml(
          videoItem.summary || ""
        )}</div>
        ${
          videoItem.sourceUrl
            ? `<a href="${normalizeUrl(
                videoItem.sourceUrl
              )}" style="color:#ff6b2d;text-decoration:none;">Watch the video</a>`
            : ""
        }
      </div>
    `
    : "";

  return `
    <div style="margin:0 auto;max-width:640px;padding:24px 18px;font-family:Arial, sans-serif;color:#1d1a16;background:#fffaf4;border:1px solid #f3e6d8;border-radius:20px;">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8c7b6b;margin-bottom:10px;">Role Model Digest</div>
      <h2 style="font-size:28px;margin:0 0 8px;">${safeName}</h2>
      <div style="color:#6c5a4d;font-size:14px;margin-bottom:16px;">Week of ${weekLabel}</div>
      <div style="font-size:16px;line-height:1.7;color:#2e2b27;margin-bottom:18px;">${summary}</div>
      ${videoHtml}
      ${sectionsHtml}
      <div style="margin-top:26px;padding-top:18px;border-top:1px solid #eee5d9;display:flex;gap:12px;flex-wrap:wrap;">
        ${
          digestUrl
            ? `<a href="${digestUrl}" style="background:#ff6b2d;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-size:14px;">View full digest</a>`
            : ""
        }
        ${
          socialUrl
            ? `<a href="${socialUrl}" style="background:#e7f5f1;color:#1f7a65;text-decoration:none;padding:10px 16px;border-radius:999px;font-size:14px;">Catch up with peers</a>`
            : ""
        }
      </div>
    </div>
  `;
}

function buildDigestEmailText(roleModelName, digest, options) {
  const weekLabel = formatEmailDate(options.weekStart);
  const lines = [
    `${roleModelName} digest`,
    `Week of ${weekLabel}`,
    "",
    digest.summaryText || "",
    ""
  ];
  const items = Array.isArray(digest.items) ? digest.items : [];
  for (const item of items) {
    const title = item.sourceTitle || "Update";
    const summary = item.summary || "";
    const url = item.sourceUrl || "";
    lines.push(`- ${title}: ${summary}${url ? ` (${url})` : ""}`);
  }
  if (options.digestUrl) {
    lines.push("", `View full digest: ${options.digestUrl}`);
  }
  if (options.socialUrl) {
    lines.push(`Social: ${options.socialUrl}`);
  }
  return lines.join("\n");
}
