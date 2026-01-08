import "../env.js";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const WIKIDATA_ENABLED = process.env.ALLOW_WIKIDATA_LOOKUP !== "false";

const MIN_RECENT_ITEMS = 5;
const MIN_UNIQUE_DOMAINS = 2;

const DEATH_STRONG_KEYWORDS = [
  "died",
  "obituary",
  "passed away",
  "funeral",
  "memorial",
  "in memoriam"
];

const DEATH_NEGATION_KEYWORDS = [
  "hoax",
  "rumor",
  "fake",
  "false",
  "alive",
  "not dead",
  "debunk",
  "still alive"
];

const ORG_KEYWORDS = [
  "company",
  "organization",
  "agency",
  "institution",
  "university",
  "college",
  "corporation",
  "nonprofit",
  "non-profit",
  "government",
  "foundation"
];

const SOCIAL_DOMAINS = [
  "twitter.com",
  "x.com",
  "instagram.com",
  "facebook.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
  "bsky.app"
];

function normalizeName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

function sanitizeSnippet(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

function extractDomain(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
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
  return exact ? exact.id : null;
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
  if (value?.time) return value.time;
  return "";
}

async function hasWikidataDeathDate(name) {
  if (!WIKIDATA_ENABLED) {
    return false;
  }
  try {
    const entityId = await fetchWikidataEntityId(name);
    if (!entityId) return false;
    const claims = await fetchWikidataClaims(entityId);
    const deathDate = extractClaimValue(claims, "P570");
    return !!deathDate;
  } catch (error) {
    return false;
  }
}

async function serperSearch(query, endpoint, options = {}) {
  const body = {
    q: query,
    num: 10
  };

  if (options.tbs) {
    body.tbs = options.tbs;
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
    const text = await response.text();
    const error = new Error(`Search provider error (${response.status})`);
    error.status = response.status;
    error.body = text.slice(0, 300);
    throw error;
  }

  return response.json();
}

async function safeSerperSearch(query, endpoint, options = {}) {
  try {
    const data = await serperSearch(query, endpoint, options);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error };
  }
}

function mapSearchItems(response) {
  return (response?.organic || []).map((item) => ({
    title: item.title || "",
    url: item.link || "",
    snippet: sanitizeSnippet(item.snippet || ""),
    date: item.date || ""
  }));
}

function mapNewsItems(response) {
  return (response?.news || []).map((item) => ({
    title: item.title || "",
    url: item.link || "",
    snippet: sanitizeSnippet(item.snippet || ""),
    date: item.date || ""
  }));
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

function matchesName(item, normalizedName) {
  const lowerName = normalizedName.toLowerCase();
  const condensed = lowerName.replace(/\s+/g, "");
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const url = (item.url || "").toLowerCase();
  return text.includes(lowerName) || (condensed && url.includes(condensed));
}

function hasDeathSignal(item, name) {
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const normalizedName = name.toLowerCase();
  if (!text.includes(normalizedName)) {
    return false;
  }
  if (DEATH_NEGATION_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return false;
  }
  return DEATH_STRONG_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isOrganizationResponse(response) {
  const type = response?.knowledgeGraph?.type || "";
  const lowerType = type.toLowerCase();
  if (!lowerType) {
    return false;
  }
  return ORG_KEYWORDS.some((keyword) => lowerType.includes(keyword));
}

export async function validateRoleModel({ name }) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    return { ok: false, reason: "Role model name required." };
  }

  if (!SERPER_API_KEY) {
    const error = new Error("Serper API key is required for role model validation");
    error.code = "SERPER_API_KEY_MISSING";
    throw error;
  }

  const [recentSearch, recentNews, deathSearch, profileSearch, wikidataDeath] = await Promise.all([
    safeSerperSearch(normalizedName, "search", { tbs: "qdr:y" }),
    safeSerperSearch(normalizedName, "news", { tbs: "qdr:y" }),
    safeSerperSearch(
      `${normalizedName} obituary OR died OR death OR "passed away"`,
      "search"
    ),
    safeSerperSearch(
      `${normalizedName} (site:instagram.com OR site:x.com OR site:twitter.com OR site:tiktok.com OR site:youtube.com OR site:linkedin.com)`,
      "search"
    ),
    hasWikidataDeathDate(normalizedName)
  ]);

  const serperFailures = [recentSearch, recentNews, deathSearch, profileSearch].filter(
    (result) => !result.ok
  );

  if (serperFailures.length === 4) {
    const firstError = serperFailures[0]?.error;
    const statusCode = firstError?.status || null;
    const status = statusCode ? ` (${statusCode})` : "";
    const message = firstError?.message || "Search provider error";
    let detail = "";
    const rawBody = firstError?.body;
    if (rawBody) {
      try {
        const parsed = JSON.parse(rawBody);
        detail = parsed?.message ? String(parsed.message) : rawBody;
      } catch (parseError) {
        detail = rawBody;
      }
      detail = detail.replace(/\s+/g, " ").trim();
      if (detail.length > 160) {
        detail = detail.slice(0, 160);
      }
    }
    const error = new Error(
      `Search provider unavailable${status}: ${detail || message}`
    );
    error.code = "SEARCH_PROVIDER_UNAVAILABLE";
    if (statusCode) {
      error.status = statusCode;
    }
    if (detail) {
      error.detail = detail;
    }
    throw error;
  }

  if (serperFailures.length) {
    console.warn("Search provider partial failure", {
      failures: serperFailures.map((result) => ({
        message: result.error?.message || "Search provider error",
        status: result.error?.status || null
      }))
    });
  }

  const recentSearchData = recentSearch.ok ? recentSearch.data : null;
  const recentNewsData = recentNews.ok ? recentNews.data : null;
  const deathSearchData = deathSearch.ok ? deathSearch.data : null;
  const profileSearchData = profileSearch.ok ? profileSearch.data : null;

  if (isOrganizationResponse(recentSearchData)) {
    return {
      ok: false,
      reason: "Role models must be living people, not organizations."
    };
  }

  const recentItems = dedupeByUrl([
    ...mapSearchItems(recentSearchData),
    ...mapNewsItems(recentNewsData)
  ]);
  const recentDomains = new Set(
    recentItems.map((item) => extractDomain(item.url)).filter(Boolean)
  );

  const profileItems = mapSearchItems(profileSearchData);
  const profileDomains = new Set(
    profileItems.map((item) => extractDomain(item.url)).filter(Boolean)
  );
  const profileMatches = profileItems.filter((item) => matchesName(item, normalizedName));
  const hasSocialProfile = [...profileDomains].some((domain) =>
    SOCIAL_DOMAINS.includes(domain)
  );

  if (wikidataDeath) {
    return {
      ok: false,
      reason:
        "Role models must be living people with a significant online presence. This name appears to refer to someone who has passed away or is memorialized."
    };
  }

  const deathItems = mapSearchItems(deathSearchData);
  const deathSignals = deathItems.filter((item) =>
    hasDeathSignal(item, normalizedName)
  ).length;

  const hasLivingPresence =
    recentItems.length >= MIN_RECENT_ITEMS && recentDomains.size >= MIN_UNIQUE_DOMAINS;
  const hasSocialPresence = hasSocialProfile && profileMatches.length >= 1;

  if (deathSignals >= 2 && !hasLivingPresence && !hasSocialPresence) {
    return {
      ok: false,
      reason:
        "Role models must be living people with a significant online presence. This name appears to refer to someone who has passed away or is memorialized."
    };
  }

  if (!hasLivingPresence) {
    if (hasSocialPresence) {
      return {
        ok: true,
        signals: {
          recentCount: recentItems.length,
          domainCount: recentDomains.size,
          socialProfiles: profileMatches.length
        }
      };
    }
    return {
      ok: false,
      reason:
        "Role models must be living people with a significant online presence. We could not find enough recent public sources for that name."
    };
  }

  return {
    ok: true,
    signals: {
      recentCount: recentItems.length,
      domainCount: recentDomains.size
    }
  };
}
