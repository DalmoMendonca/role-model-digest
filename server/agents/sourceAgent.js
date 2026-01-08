import "../env.js";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const DEFAULT_WEEKLY_TBS = "qdr:w";
const WIKIDATA_ENABLED = process.env.ALLOW_WIKIDATA_LOOKUP !== "false";
const MAX_SOURCE_TEXT = 12000;

const SOCIAL_POST_PATTERNS = [
  /twitter\.com\/[^/]+\/status\//i,
  /x\.com\/[^/]+\/status\//i,
  /instagram\.com\/(p|reel)\//i,
  /facebook\.com\/[^/]+\/posts\//i,
  /facebook\.com\/[^/]+\/videos\//i,
  /facebook\.com\/story\.php/i,
  /linkedin\.com\/posts\//i,
  /linkedin\.com\/feed\/update\//i,
  /tiktok\.com\/@[^/]+\/video\//i,
  /bsky\.app\/profile\/[^/]+\/post\//i
];

const SOCIAL_PROFILE_DOMAINS = [
  "twitter.com",
  "x.com",
  "instagram.com",
  "facebook.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
  "bsky.app"
];

const SOCIAL_HANDLE_BLOCKLIST = new Set([
  "home",
  "search",
  "hashtag",
  "intent",
  "share",
  "i",
  "explore",
  "status",
  "p",
  "reel",
  "reels",
  "tv",
  "posts",
  "videos"
]);

function sanitizeSnippet(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

function normalizeHandle(value) {
  if (!value) return "";
  return value
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/^(x\.com|twitter\.com|instagram\.com|facebook\.com|linkedin\.com)\//i, "")
    .replace(/\/$/, "");
}

function isSocialPostUrl(url) {
  return SOCIAL_POST_PATTERNS.some((pattern) => pattern.test(url || ""));
}

function isSocialProfileUrl(url) {
  const lowerUrl = (url || "").toLowerCase();
  if (!SOCIAL_PROFILE_DOMAINS.some((domain) => lowerUrl.includes(domain))) {
    return false;
  }
  if (isSocialPostUrl(url)) {
    return false;
  }
  if (lowerUrl.includes("youtube.com/watch") || lowerUrl.includes("youtu.be/")) {
    return false;
  }
  return true;
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

function normalizeNameTokens(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreBioSource(item, nameTokens, fullName) {
  const text = `${item.title || ""} ${item.snippet || ""}`.toLowerCase();
  const url = (item.url || "").toLowerCase();
  const condensed = nameTokens.join("");
  const hasFullName =
    fullName &&
    (text.includes(fullName) || url.includes(fullName) || (condensed && url.includes(condensed)));
  const tokenMatches = nameTokens.filter(
    (token) => text.includes(token) || url.includes(token)
  ).length;
  let score = tokenMatches;
  if (hasFullName) {
    score += 2;
  }
  if (isSocialProfileUrl(item.url)) {
    score += 1;
  }
  if (item.sourceType === "news") {
    score += 0.5;
  }
  const minScore = nameTokens.length > 1 ? 2 : 1;
  return {
    score,
    isStrong: hasFullName || score >= minScore
  };
}

function scoreImageCandidate(candidate, nameTokens, handleHints) {
  const title = (candidate.title || candidate.snippet || "").toLowerCase();
  const link = (candidate.link || candidate.sourceUrl || "").toLowerCase();
  const source = (candidate.source || "").toLowerCase();
  const imageUrl = (candidate.imageUrl || candidate.thumbnailUrl || "").toLowerCase();
  const text = `${title} ${link} ${source} ${imageUrl}`;
  let score = Number.isFinite(candidate.boost) ? candidate.boost : 0;

  const tokenMatches = nameTokens.filter((token) => text.includes(token)).length;
  score += tokenMatches * 2;

  const hasHandle = handleHints.some((handle) =>
    handle ? text.includes(handle.toLowerCase()) : false
  );
  if (hasHandle) {
    score += 3;
  }

  if (text.includes("instagram.com")) score += 2;
  if (text.includes("x.com") || text.includes("twitter.com")) score += 2;
  if (text.includes("youtube.com")) score += 1;
  if (text.includes("tiktok.com")) score += 1;
  if (text.includes("portrait") || text.includes("headshot") || text.includes("profile")) {
    score += 1;
  }
  if (
    text.includes("commons.wikimedia.org") ||
    text.includes("wikipedia.org") ||
    text.includes("wikidata.org")
  ) {
    score += 3;
  }
  if (text.includes("gstatic.com")) {
    score += 2;
  }

  if (
    text.includes("logo") ||
    text.includes("brand") ||
    text.includes("icon") ||
    text.includes("vector") ||
    text.includes("stock")
  ) {
    score -= 3;
  }
  if (
    text.includes("book cover") ||
    (text.includes("cover") && text.includes("book")) ||
    text.includes("paperback") ||
    text.includes("hardcover") ||
    text.includes("kindle") ||
    text.includes("isbn") ||
    text.includes("goodreads") ||
    text.includes("amazon.com")
  ) {
    score -= 4;
  } else if (text.includes("book") || text.includes("novel")) {
    score -= 2;
  }
  if (text.includes("album cover") || text.includes("tracklist")) {
    score -= 2;
  } else if (text.includes("album") || text.includes("spotify") || text.includes("itunes")) {
    score -= 1;
  }
  if (imageUrl.endsWith(".svg")) {
    score -= 4;
  }

  const width = Number(candidate.imageWidth || candidate.thumbnailWidth);
  const height = Number(candidate.imageHeight || candidate.thumbnailHeight);
  if (Number.isFinite(width) && width < 120) score -= 2;
  if (Number.isFinite(height) && height < 120) score -= 2;
  if (Number.isFinite(width) && Number.isFinite(height) && width >= 300 && height >= 300) {
    score += 1;
  }
  if (Number.isFinite(width) && Number.isFinite(height) && width >= 800 && height >= 800) {
    score += 1;
  }

  return score;
}

function isBlockedImageHost(url) {
  const lowerUrl = (url || "").toLowerCase();
  const blockedHosts = [
    "instagram.com",
    "cdninstagram.com",
    "facebook.com",
    "fbcdn.net"
  ];
  return blockedHosts.some((host) => lowerUrl.includes(host));
}

function resolveImageUrl(candidate) {
  const directUrl = candidate.imageUrl || "";
  const thumbnailUrl = candidate.thumbnailUrl || "";
  if (directUrl.startsWith("data:")) {
    return thumbnailUrl && !thumbnailUrl.startsWith("data:") ? thumbnailUrl : "";
  }
  if (thumbnailUrl.startsWith("data:")) {
    return directUrl;
  }
  if (!directUrl) {
    return thumbnailUrl || "";
  }
  if (isBlockedImageHost(directUrl) && thumbnailUrl) {
    return thumbnailUrl;
  }
  return directUrl;
}

function extractMetaImage(html, prop, attr = "property") {
  const regexOrderA = new RegExp(
    `${attr}=["']${prop}["'][^>]*content=["']([^"']+)["']`,
    "i"
  );
  const regexOrderB = new RegExp(
    `content=["']([^"']+)["'][^>]*${attr}=["']${prop}["']`,
    "i"
  );
  return (html.match(regexOrderA) || html.match(regexOrderB) || [])[1] || "";
}

function extractLinkImage(html) {
  const regexOrderA = /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i;
  const regexOrderB = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']image_src["']/i;
  return (html.match(regexOrderA) || html.match(regexOrderB) || [])[1] || "";
}

function resolveUrl(maybeUrl, baseUrl) {
  try {
    return new URL(maybeUrl, baseUrl).toString();
  } catch (error) {
    return maybeUrl || "";
  }
}

async function fetchOpenGraphImage(pageUrl) {
  if (!pageUrl) return "";
  try {
    const response = await fetch(pageUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) return "";
    const html = (await response.text()).slice(0, 200000);
    const ogImage =
      extractMetaImage(html, "og:image") ||
      extractMetaImage(html, "og:image:url") ||
      extractMetaImage(html, "og:image:secure_url") ||
      extractMetaImage(html, "twitter:image", "name") ||
      extractMetaImage(html, "twitter:image:src", "name") ||
      extractMetaImage(html, "image", "name") ||
      extractMetaImage(html, "thumbnail", "name") ||
      extractMetaImage(html, "twitter:image", "property") ||
      extractLinkImage(html);
    if (!ogImage) return "";
    if (ogImage.startsWith("data:")) return "";
    return resolveUrl(ogImage, pageUrl);
  } catch (error) {
    return "";
  }
}

function extractKnowledgeGraphImage(response) {
  const knowledgeGraph = response?.knowledgeGraph || {};
  const imageUrl = knowledgeGraph.imageUrl || knowledgeGraph.image || "";
  const sourceUrl = knowledgeGraph.descriptionUrl || knowledgeGraph.website || "";
  if (!imageUrl) return null;
  return {
    title: knowledgeGraph.title || "Knowledge graph",
    imageUrl,
    sourceUrl,
    boost: 6
  };
}

async function fetchWikidataImage(roleModelName) {
  if (!WIKIDATA_ENABLED) {
    return null;
  }
  try {
    const entityId = await fetchWikidataEntityId(roleModelName);
    if (!entityId) return null;
    const claims = await fetchWikidataClaims(entityId);
    const imageName = extractClaimValue(claims, "P18");
    if (!imageName) return null;
    const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
      imageName
    )}`;
    return {
      title: `${roleModelName} (Wikimedia Commons)`,
      imageUrl,
      sourceUrl: `https://www.wikidata.org/wiki/${entityId}`,
      boost: 8
    };
  } catch (error) {
    return null;
  }
}

function extractHandleFromUrl(url, domain) {
  const lowerUrl = (url || "").toLowerCase();
  if (domain === "linkedin.com") {
    const match = lowerUrl.match(/linkedin\.com\/(in|company)\/([^/?#]+)/i);
    if (!match) return "";
    const handle = normalizeHandle(match[2]);
    if (!handle || SOCIAL_HANDLE_BLOCKLIST.has(handle.toLowerCase())) {
      return "";
    }
    return handle;
  }

  const match = lowerUrl.match(new RegExp(`${domain}/([^/?#]+)`, "i"));
  if (!match) return "";
  const handle = normalizeHandle(match[1]);
  if (!handle || SOCIAL_HANDLE_BLOCKLIST.has(handle.toLowerCase())) {
    return "";
  }
  return handle;
}

function extractYouTubeProfile(url) {
  const lowerUrl = (url || "").toLowerCase();
  let match = lowerUrl.match(/youtube\.com\/channel\/([^/?#]+)/i);
  if (match) {
    return { channelId: match[1], username: "" };
  }
  match = lowerUrl.match(/youtube\.com\/@([^/?#]+)/i);
  if (match) {
    return { channelId: "", username: match[1] };
  }
  match = lowerUrl.match(/youtube\.com\/user\/([^/?#]+)/i);
  if (match) {
    return { channelId: "", username: match[1] };
  }
  match = lowerUrl.match(/youtube\.com\/c\/([^/?#]+)/i);
  if (match) {
    return { channelId: "", username: match[1] };
  }
  return { channelId: "", username: "" };
}

async function discoverHandlesFromSearch(roleModelName) {
  if (!SERPER_API_KEY) return {};
  try {
    const response = await serperSearch(
      `${roleModelName} (site:instagram.com OR site:x.com OR site:twitter.com OR site:facebook.com OR site:linkedin.com OR site:tiktok.com OR site:youtube.com)`,
      "search",
      { includeTbs: false, num: 8 }
    );
    const urls = (response.organic || []).map((item) => item.link || "").filter(Boolean);
    let twitter = "";
    let instagram = "";
    let facebook = "";
    let linkedin = "";
    let tiktok = "";
    let youtubeChannelId = "";
    let youtubeUsername = "";

    for (const url of urls) {
      if (!twitter) {
        twitter =
          extractHandleFromUrl(url, "x.com") || extractHandleFromUrl(url, "twitter.com");
      }
      if (!instagram) {
        instagram = extractHandleFromUrl(url, "instagram.com");
      }
      if (!facebook) {
        facebook = extractHandleFromUrl(url, "facebook.com");
      }
      if (!linkedin) {
        linkedin = extractHandleFromUrl(url, "linkedin.com");
      }
      if (!tiktok) {
        tiktok = extractHandleFromUrl(url, "tiktok.com");
      }
      if (!isVideoUrl(url) && (url.includes("youtube.com") || url.includes("youtu.be"))) {
        const profile = extractYouTubeProfile(url);
        if (!youtubeChannelId && profile.channelId) {
          youtubeChannelId = profile.channelId;
        }
        if (!youtubeUsername && profile.username) {
          youtubeUsername = profile.username;
        }
      }
    }

    return {
      twitter,
      instagram,
      facebook,
      linkedin,
      tiktok,
      youtubeChannelId,
      youtubeUsername
    };
  } catch (error) {
    return {};
  }
}

async function serperSearch(query, endpoint, options = {}) {
  const body = {
    q: query,
    num: options.num || 10
  };

  if (options.tbs) {
    body.tbs = options.tbs;
  } else if (options.includeTbs !== false) {
    body.tbs = DEFAULT_WEEKLY_TBS;
  }

  const response = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": SERPER_API_KEY
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error("Search provider error");
  }

  return response.json();
}

async function fetchWikidataEntityId(name) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=5&search=${encodeURIComponent(
    name
  )}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error("Wikidata search failed");
  }
  const data = await response.json();
  const results = Array.isArray(data?.search) ? data.search : [];
  if (!results.length) {
    return null;
  }
  const exact = results.find(
    (entry) => entry.label?.toLowerCase() === name.toLowerCase()
  );
  return (exact || results[0]).id || null;
}

async function fetchWikidataClaims(entityId) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error("Wikidata entity fetch failed");
  }
  const data = await response.json();
  return data?.entities?.[entityId]?.claims || {};
}

function extractClaimValue(claims, property) {
  const entries = claims?.[property];
  if (!Array.isArray(entries) || !entries.length) return "";
  const value = entries[0]?.mainsnak?.datavalue?.value;
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?.id) return value.id;
  if (value?.text) return value.text;
  return "";
}

async function discoverTwitterHandle(roleModelName) {
  if (!SERPER_API_KEY) return "";
  try {
    const response = await serperSearch(`${roleModelName} official X account`, "search", {
      tbs: "qdr:y",
      num: 5
    });
    const urls = (response.organic || []).map((item) => item.link || "").filter(Boolean);
    for (const url of urls) {
      const handle =
        extractHandleFromUrl(url, "x.com") || extractHandleFromUrl(url, "twitter.com");
      if (handle) return handle;
    }
    return "";
  } catch (error) {
    return "";
  }
}

async function discoverInstagramHandle(roleModelName) {
  if (!SERPER_API_KEY) return "";
  try {
    const response = await serperSearch(
      `site:instagram.com ${roleModelName}`,
      "search",
      { tbs: "qdr:y", num: 5 }
    );
    const urls = (response.organic || []).map((item) => item.link || "").filter(Boolean);
    for (const url of urls) {
      const handle = extractHandleFromUrl(url, "instagram.com");
      if (handle) return handle;
    }
    return "";
  } catch (error) {
    return "";
  }
}

export async function fetchOfficialProfiles(roleModelName) {
  try {
    let twitter = "";
    let instagram = "";
    let facebook = "";
    let linkedin = "";
    let tiktok = "";
    let youtubeChannelId = "";
    let youtubeUsername = "";

    if (WIKIDATA_ENABLED) {
      const entityId = await fetchWikidataEntityId(roleModelName);
      if (entityId) {
        const claims = await fetchWikidataClaims(entityId);
        twitter = normalizeHandle(extractClaimValue(claims, "P2002"));
        instagram = normalizeHandle(extractClaimValue(claims, "P2003"));
        facebook = normalizeHandle(extractClaimValue(claims, "P2013"));
        linkedin = normalizeHandle(extractClaimValue(claims, "P6634"));
        youtubeChannelId = extractClaimValue(claims, "P2397");
        youtubeUsername = normalizeHandle(extractClaimValue(claims, "P1651"));
      }
    }

    if (!twitter) {
      twitter = await discoverTwitterHandle(roleModelName);
    }
    if (!instagram) {
      instagram = await discoverInstagramHandle(roleModelName);
    }
    if (!twitter || !instagram || !facebook || !linkedin || !youtubeChannelId || !youtubeUsername || !tiktok) {
      const discovered = await discoverHandlesFromSearch(roleModelName);
      twitter = twitter || discovered.twitter || "";
      instagram = instagram || discovered.instagram || "";
      facebook = facebook || discovered.facebook || "";
      linkedin = linkedin || discovered.linkedin || "";
      tiktok = tiktok || discovered.tiktok || "";
      youtubeChannelId = youtubeChannelId || discovered.youtubeChannelId || "";
      youtubeUsername = youtubeUsername || discovered.youtubeUsername || "";
    }

    return {
      twitter,
      instagram,
      facebook,
      linkedin,
      tiktok,
      youtubeChannelId,
      youtubeUsername
    };
  } catch (error) {
    console.warn("Official profile lookup failed", error);
    return {};
  }
}

async function fetchCustomSource(url) {
  if (process.env.ALLOW_SOURCE_FETCH !== "true") {
    return `Custom source: ${url}`;
  }
  try {
    const response = await fetch(url, { method: "GET" });
    const html = await response.text();
    const text = html.replace(/<[^>]+>/g, " ");
    return sanitizeSnippet(text.slice(0, 360));
  } catch (error) {
    return `Custom source: ${url}`;
  }
}

export async function fetchSourceText(url, maxChars = MAX_SOURCE_TEXT) {
  if (!url || process.env.ALLOW_SOURCE_FETCH !== "true") {
    return "";
  }
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) return "";
    const html = await response.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
    return sanitizeSnippet(text).slice(0, maxChars);
  } catch (error) {
    return "";
  }
}

async function fetchYouTubeFeed(channelId, weekStart) {
  if (!channelId) return [];
  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(
      channelId
    )}`;
    const response = await fetch(feedUrl, { method: "GET" });
    if (!response.ok) return [];
    const xml = await response.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const weekStartDate = new Date(weekStart);
    return entries
      .map((entry) => {
        const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
        const link = (entry.match(/<link[^>]+href="([^"]+)"/) || [])[1] || "";
        const published =
          (entry.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || "";
        const description =
          (entry.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] ||
          "";
        if (!published) return null;
        const publishedAt = new Date(published);
        if (Number.isNaN(publishedAt.getTime())) return null;
        if (publishedAt < weekStartDate) return null;
        return {
          title: sanitizeSnippet(title),
          url: link,
          snippet: sanitizeSnippet(description).slice(0, 260),
          sourceType: "video",
          date: publishedAt.toISOString().split("T")[0]
        };
      })
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.url || "").toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function collectSources({ roleModelName, weekStart, customSources = [] }) {
  const items = [];
  let news = { news: [] };
  let search = { organic: [] };
  let social = { organic: [] };
  let videos = { organic: [] };
  let officialProfiles = {};

  try {
    officialProfiles = await fetchOfficialProfiles(roleModelName);
  } catch (error) {
    officialProfiles = {};
  }

  if (SERPER_API_KEY) {
    try {
      const socialQueries = [];
      if (officialProfiles.twitter) {
        socialQueries.push(
          `site:x.com/${officialProfiles.twitter}`,
          `site:twitter.com/${officialProfiles.twitter}`
        );
      }
      if (officialProfiles.instagram) {
        socialQueries.push(`site:instagram.com/${officialProfiles.instagram}`);
      }
      if (officialProfiles.facebook) {
        socialQueries.push(`site:facebook.com/${officialProfiles.facebook}`);
      }
    if (officialProfiles.linkedin) {
      socialQueries.push(`site:linkedin.com/${officialProfiles.linkedin}`);
    }
    if (officialProfiles.tiktok) {
      socialQueries.push(`site:tiktok.com/@${officialProfiles.tiktok}`);
    }

      const socialQuery =
        socialQueries.length > 0
          ? socialQueries.join(" OR ")
          : `${roleModelName} (site:twitter.com OR site:x.com OR site:instagram.com OR site:facebook.com OR site:linkedin.com OR site:tiktok.com OR site:bsky.app)`;

      const videoQueryBase =
        "(site:youtube.com/watch OR site:youtu.be OR site:youtube.com/shorts OR site:youtube.com/live)";
      const videoQueries = [`${roleModelName} ${videoQueryBase}`];
      if (officialProfiles.youtubeUsername) {
        videoQueries.push(`${officialProfiles.youtubeUsername} ${videoQueryBase}`);
      }
      const videoQuery = videoQueries.join(" OR ");

      [news, search, social, videos] = await Promise.all([
        serperSearch(`${roleModelName} update`, "news", { tbs: "qdr:w" }),
        serperSearch(`${roleModelName} interview OR statement OR "thread"`, "search", {
          tbs: "qdr:w"
        }),
        serperSearch(socialQuery, "search", { tbs: "qdr:w" }),
        serperSearch(videoQuery, "search", { tbs: "qdr:w" })
      ]);
    } catch (error) {
      console.warn("Source collection failed", error);
    }
  }

  const newsItems = (news.news || []).map((item) => ({
    title: item.title,
    url: item.link,
    snippet: sanitizeSnippet(item.snippet),
    sourceType: isVideoUrl(item.link) ? "video" : "news",
    date: item.date
  }));

  const searchItems = (search.organic || []).map((item) => ({
    title: item.title,
    url: item.link,
    snippet: sanitizeSnippet(item.snippet),
    sourceType: isVideoUrl(item.link)
      ? "video"
      : isSocialPostUrl(item.link)
      ? "social"
      : "web",
    date: item.date
  }));

  const socialItems = (social.organic || [])
    .filter((item) => isSocialPostUrl(item.link))
    .map((item) => ({
      title: item.title,
      url: item.link,
      snippet: sanitizeSnippet(item.snippet),
      sourceType: "social",
      date: item.date
    }));

  let videoItems = (videos.organic || [])
    .filter((item) => isVideoUrl(item.link))
    .map((item) => ({
      title: item.title,
      url: item.link,
      snippet: sanitizeSnippet(item.snippet),
      sourceType: "video",
      date: item.date
    }));

  if (officialProfiles.youtubeChannelId) {
    const feedVideos = await fetchYouTubeFeed(officialProfiles.youtubeChannelId, weekStart);
    if (feedVideos.length) {
      videoItems = dedupeByUrl([...videoItems, ...feedVideos]);
    }
  }

  if (!videoItems.length && SERPER_API_KEY) {
    try {
      const fallbackVideos = await serperSearch(`${roleModelName} youtube`, "search", {
        tbs: "qdr:w",
        num: 10
      });
      videoItems = (fallbackVideos.organic || [])
        .filter((item) => isVideoUrl(item.link))
        .map((item) => ({
          title: item.title,
          url: item.link,
          snippet: sanitizeSnippet(item.snippet),
          sourceType: "video",
          date: item.date
        }));
    } catch (error) {
      console.warn("Fallback video search failed", error);
    }
  }

  items.push(...newsItems, ...searchItems, ...socialItems, ...videoItems);

  for (const source of customSources) {
    const snippet = await fetchCustomSource(source.url);
    items.push({
      title: source.label || source.url,
      url: source.url,
      snippet,
      sourceType: "custom",
      date: weekStart.toISOString().split("T")[0]
    });
  }

  return dedupeByUrl(items);
}


export async function collectBioSources({ roleModelName }) {
  if (!SERPER_API_KEY) {
    return [];
  }

  try {
    let officialProfiles = {};
    try {
      officialProfiles = await fetchOfficialProfiles(roleModelName);
    } catch (error) {
      officialProfiles = {};
    }

    const [primaryResult, profilesResult, newsResult] = await Promise.allSettled([
      serperSearch(roleModelName, "search", { includeTbs: false }),
      serperSearch(
        `${roleModelName} (instagram OR x OR twitter OR tiktok OR youtube OR "official site" OR "personal website")`,
        "search",
        { includeTbs: false }
      ),
      serperSearch(`${roleModelName} interview OR statement`, "news", {
        tbs: "qdr:y",
        includeTbs: true
      })
    ]);

    const primary =
      primaryResult.status === "fulfilled" ? primaryResult.value : { organic: [] };
    const profiles =
      profilesResult.status === "fulfilled" ? profilesResult.value : { organic: [] };
    const news = newsResult.status === "fulfilled" ? newsResult.value : { news: [] };

    const mapSearchItems = (items = []) =>
      items.map((item) => ({
        title: item.title,
        url: item.link,
        snippet: sanitizeSnippet(item.snippet),
        sourceType: isVideoUrl(item.link)
          ? "video"
          : isSocialProfileUrl(item.link)
          ? "social"
          : "web",
        date: item.date
      }));

    const searchItems = mapSearchItems(primary.organic || []);
    const profileItems = mapSearchItems(profiles.organic || []);
    const newsItems = (news.news || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: sanitizeSnippet(item.snippet),
      sourceType: "news",
      date: item.date
    }));

    const profileSources = [];
    if (officialProfiles.twitter) {
      profileSources.push({
        title: `X profile: @${officialProfiles.twitter}`,
        url: `https://x.com/${officialProfiles.twitter}`,
        snippet: `Official X profile for ${roleModelName}.`,
        sourceType: "social",
        date: ""
      });
    }
    if (officialProfiles.instagram) {
      profileSources.push({
        title: `Instagram profile: @${officialProfiles.instagram}`,
        url: `https://www.instagram.com/${officialProfiles.instagram}`,
        snippet: `Official Instagram profile for ${roleModelName}.`,
        sourceType: "social",
        date: ""
      });
    }
    if (officialProfiles.facebook) {
      profileSources.push({
        title: `Facebook profile: ${officialProfiles.facebook}`,
        url: `https://www.facebook.com/${officialProfiles.facebook}`,
        snippet: `Official Facebook profile for ${roleModelName}.`,
        sourceType: "social",
        date: ""
      });
    }
    if (officialProfiles.linkedin) {
      profileSources.push({
        title: `LinkedIn profile: ${officialProfiles.linkedin}`,
        url: `https://www.linkedin.com/in/${officialProfiles.linkedin}`,
        snippet: `Official LinkedIn profile for ${roleModelName}.`,
        sourceType: "social",
        date: ""
      });
    }
    if (officialProfiles.tiktok) {
      profileSources.push({
        title: `TikTok profile: @${officialProfiles.tiktok}`,
        url: `https://www.tiktok.com/@${officialProfiles.tiktok}`,
        snippet: `Official TikTok profile for ${roleModelName}.`,
        sourceType: "social",
        date: ""
      });
    }
    if (officialProfiles.youtubeUsername) {
      profileSources.push({
        title: `YouTube channel: @${officialProfiles.youtubeUsername}`,
        url: `https://www.youtube.com/@${officialProfiles.youtubeUsername}`,
        snippet: `Official YouTube channel for ${roleModelName}.`,
        sourceType: "video",
        date: ""
      });
    } else if (officialProfiles.youtubeChannelId) {
      profileSources.push({
        title: "YouTube channel",
        url: `https://www.youtube.com/channel/${officialProfiles.youtubeChannelId}`,
        snippet: `Official YouTube channel for ${roleModelName}.`,
        sourceType: "video",
        date: ""
      });
    }

    const nameTokens = normalizeNameTokens(roleModelName);
    const fullName = nameTokens.join(" ");
    const scored = [
      ...searchItems,
      ...profileItems,
      ...newsItems,
      ...profileSources
    ]
      .map((item) => {
        const { score, isStrong } = scoreBioSource(item, nameTokens, fullName);
        return { ...item, score, isStrong };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.snippet || "").length - (a.snippet || "").length;
      });

    const deduped = dedupeByUrl(scored);
    return deduped.slice(0, 12);
  } catch (error) {
    console.warn("Bio source collection failed", error);
    return [];
  }
}

export async function fetchRoleModelImage({ roleModelName }) {
  if (!SERPER_API_KEY) {
    return null;
  }

  try {
    let officialProfiles = {};
    try {
      officialProfiles = await fetchOfficialProfiles(roleModelName);
    } catch (error) {
      officialProfiles = {};
    }

    let knowledgeGraphCandidate = null;
    let searchResponse = null;
    let searchPageUrls = [];
    try {
      searchResponse = await serperSearch(roleModelName, "search", {
        includeTbs: false,
        num: 5
      });
      knowledgeGraphCandidate = extractKnowledgeGraphImage(searchResponse);
      searchPageUrls = Array.isArray(searchResponse?.organic)
        ? searchResponse.organic
            .map((item) => item.link || "")
            .filter((url) => url && !isVideoUrl(url))
            .slice(0, 5)
        : [];
    } catch (error) {
      knowledgeGraphCandidate = null;
    }

    const wikidataCandidate = await fetchWikidataImage(roleModelName);

    const queries = [
      `${roleModelName} portrait`,
      `${roleModelName} headshot`,
      `${roleModelName} profile photo`,
      `${roleModelName} instagram`,
      `${roleModelName} x profile`
    ];
    const profileUrls = [];
    if (officialProfiles.instagram) {
      profileUrls.push(`https://www.instagram.com/${officialProfiles.instagram}`);
      queries.push(
        `site:instagram.com/${officialProfiles.instagram} ${roleModelName}`
      );
    }
    if (officialProfiles.twitter) {
      profileUrls.push(`https://x.com/${officialProfiles.twitter}`);
      queries.push(
        `site:x.com/${officialProfiles.twitter} ${roleModelName}`,
        `site:twitter.com/${officialProfiles.twitter} ${roleModelName}`
      );
    }
    if (officialProfiles.facebook) {
      profileUrls.push(`https://www.facebook.com/${officialProfiles.facebook}`);
      queries.push(`site:facebook.com/${officialProfiles.facebook} ${roleModelName}`);
    }
    if (officialProfiles.linkedin) {
      profileUrls.push(`https://www.linkedin.com/in/${officialProfiles.linkedin}`);
      queries.push(`site:linkedin.com/in/${officialProfiles.linkedin} ${roleModelName}`);
    }
    if (officialProfiles.tiktok) {
      profileUrls.push(`https://www.tiktok.com/@${officialProfiles.tiktok}`);
      queries.push(`site:tiktok.com/@${officialProfiles.tiktok} ${roleModelName}`);
    }
    if (officialProfiles.youtubeUsername) {
      profileUrls.push(`https://www.youtube.com/@${officialProfiles.youtubeUsername}`);
      queries.push(`site:youtube.com/@${officialProfiles.youtubeUsername} ${roleModelName}`);
    } else if (officialProfiles.youtubeChannelId) {
      profileUrls.push(`https://www.youtube.com/channel/${officialProfiles.youtubeChannelId}`);
      queries.push(
        `site:youtube.com/channel/${officialProfiles.youtubeChannelId} ${roleModelName}`
      );
    }

    const responses = await Promise.allSettled(
      queries.map((query) =>
        serperSearch(query, "images", {
          includeTbs: false,
          num: 10,
          tbs: query.includes("portrait") || query.includes("headshot") ? "itp:face" : ""
        })
      )
    );
    const images = responses.flatMap((result) =>
      result.status === "fulfilled" && Array.isArray(result.value?.images)
        ? result.value.images
        : []
    );
    const uniqueProfileUrls = dedupeByUrl(
      profileUrls
        .filter(Boolean)
        .map((url) => ({ url }))
    ).map((entry) => entry.url);

    const pageUrls = dedupeByUrl(
      [...uniqueProfileUrls, ...searchPageUrls].map((url) => ({ url }))
    ).map((entry) => entry.url);
    const profileUrlSet = new Set(uniqueProfileUrls.map((url) => url.toLowerCase()));
    const ogImages = await Promise.all(
      pageUrls.slice(0, 8).map(async (url) => {
        const ogImage = await fetchOpenGraphImage(url);
        return ogImage
          ? {
              title: `${roleModelName} profile`,
              imageUrl: ogImage,
              sourceUrl: url,
              boost: profileUrlSet.has(url.toLowerCase()) ? 5 : 3
            }
          : null;
      })
    );

    const nameTokens = normalizeNameTokens(roleModelName);
    const handleHints = [
      officialProfiles.instagram,
      officialProfiles.twitter,
      officialProfiles.facebook,
      officialProfiles.linkedin,
      officialProfiles.tiktok,
      officialProfiles.youtubeUsername
    ].filter(Boolean);
    const seen = new Set();
    const baseCandidates = [
      ...images,
      ...ogImages.filter(Boolean),
      knowledgeGraphCandidate,
      wikidataCandidate
    ].filter(Boolean);
    const scored = baseCandidates
      .map((item) => ({
        ...item,
        imageUrl: resolveImageUrl(item),
        sourceUrl: item.link || item.sourceUrl || ""
      }))
      .filter((item) => {
        const key = (item.imageUrl || "").toLowerCase();
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((item) => ({
        ...item,
        score: scoreImageCandidate(item, nameTokens, handleHints)
      }))
      .sort((a, b) => b.score - a.score);

    const candidate = scored[0];
    if (!candidate || !candidate.imageUrl) {
      return null;
    }

    return {
      imageUrl: candidate.imageUrl,
      sourceUrl: candidate.sourceUrl || ""
    };
  } catch (error) {
    console.warn("Role model image lookup failed", error);
    return null;
  }
}
