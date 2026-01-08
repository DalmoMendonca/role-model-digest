import "../env.js";
import crypto from "crypto";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";

const SOCIAL_DOMAINS = [
  "twitter.com",
  "x.com",
  "instagram.com",
  "facebook.com",
  "linkedin.com",
  "tiktok.com",
  "bsky.app"
];

function isSocialUrl(url) {
  const lowerUrl = (url || "").toLowerCase();
  return SOCIAL_DOMAINS.some((domain) => lowerUrl.includes(domain));
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

function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pruneRoleModelRepeats(text, roleModelName) {
  if (!roleModelName) return text;
  const pattern = new RegExp(escapeRegExp(roleModelName), "gi");
  const matches = text.match(pattern) || [];
  if (matches.length <= 1) {
    return text;
  }
  let count = 0;
  return text.replace(pattern, () => {
    count += 1;
    return count === 1 ? roleModelName : "they";
  });
}

function dedupeCandidates(candidates, previousKeys) {
  const seen = new Set(previousKeys);
  return candidates.filter((item) => {
    const key = `${item.url || ""}|${item.title || ""}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildFallback(candidates, roleModelName) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const items = safeCandidates
    .filter((item) => item && (item.title || item.url || item.snippet))
    .slice(0, 6)
    .map((item) => ({
      sourceTitle: item.title || item.url || "Update",
      sourceUrl: item.url || "",
      sourceType: item.sourceType || "web",
      sourceDate: item.date || "",
      summary: item.snippet || "Update captured from the weekly scan."
    }));

  return {
    summaryText: items.length
      ? buildThemeFromCandidates(safeCandidates, roleModelName)
      : `This week focused on a quiet signal for ${roleModelName}.`,
    topics: items.length ? ["weekly signal", "coverage"] : ["quiet week"],
    takeaways: [],
    items
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }
  const output = Array.isArray(data?.output) ? data.output : [];
  const chunks = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const entry of content) {
      if (entry?.type === "output_text" && typeof entry.text === "string") {
        chunks.push(entry.text);
      }
    }
  }
  return chunks.join("").trim();
}

function normalizeSummary(text, roleModelName) {
  const trimmed = `${text || ""}`.trim();
  if (!trimmed) {
    return `This week focused on a scan of ${roleModelName}'s latest signals.`;
  }
  return pruneRoleModelRepeats(trimmed, roleModelName);
}


function buildThemeFromCandidates(candidates, roleModelName) {
  const typeRank = { news: 0, video: 1, social: 2, web: 3, custom: 4 };
  const ranked = candidates
    .filter((item) => item && (item.title || item.snippet))
    .sort((a, b) => {
      const rankA = typeRank[a.sourceType] ?? 5;
      const rankB = typeRank[b.sourceType] ?? 5;
      if (rankA !== rankB) return rankA - rankB;
      const snippetA = (a.snippet || "").length;
      const snippetB = (b.snippet || "").length;
      return snippetB - snippetA;
    });

  const lead = ranked[0];
  if (!lead) {
    return `This week focused on a scan of ${roleModelName}'s latest signals.`;
  }

  const title = `${lead.title || lead.url || roleModelName}`.trim();
  const snippet = `${lead.snippet || ""}`.trim();
  const snippetSentence = snippet
    ? snippet.replace(/[.!?]+$/, "")
    : "";
  const cleanedSnippet = pruneRoleModelRepeats(snippetSentence || "", roleModelName);

  let sentence = `This week focused on ${title}`;
  if (cleanedSnippet) {
    const firstWord = cleanedSnippet.split(/\s+/)[0]?.toLowerCase() || "";
    const nameStart = roleModelName
      ? cleanedSnippet.toLowerCase().startsWith(roleModelName.toLowerCase())
      : false;
    const connector =
      nameStart || ["they", "he", "she", "the"].includes(firstWord) ? "as" : "with";
    const shouldLower = ["they", "he", "she", "the", "a", "an"].includes(firstWord);
    const snippetClause = shouldLower
      ? cleanedSnippet.charAt(0).toLowerCase() + cleanedSnippet.slice(1)
      : cleanedSnippet;
    sentence = `${sentence}, ${connector} ${snippetClause}.`;
  } else {
    sentence = `${sentence}.`;
  }

  if (sentence.length > 180) {
    const trimmed = sentence.slice(0, 177);
    const cutoff = trimmed.lastIndexOf(" ");
    return `${trimmed.slice(0, cutoff > 120 ? cutoff : 177)}...`;
  }

  return sentence;
}

function mapCandidateToItem(candidate) {
  return {
    sourceTitle: candidate.title || candidate.url || "Update",
    sourceUrl: candidate.url || "",
    sourceType: candidate.sourceType || "web",
    sourceDate: candidate.date || "",
    summary: candidate.snippet || "Update captured from the weekly scan."
  };
}

export async function generateDigest({ roleModelName, weekStart, candidates, previousKeys }) {
  if (!OPENAI_API_KEY) {
    return buildFallback(candidates, roleModelName);
  }

  const deduped = dedupeCandidates(candidates, previousKeys);
  if (!deduped.length) {
    return buildFallback([], roleModelName);
  }

  const videoCandidates = deduped.filter(
    (item) => item.sourceType === "video" || isVideoUrl(item.url)
  );
  const socialCandidates = deduped.filter(
    (item) => item.sourceType === "social" || isSocialUrl(item.url)
  );

  let response;
  try {
    response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are a digest editor. Only include new, non-duplicative items. Return JSON only. Use only the provided candidates; do not invent new facts or sources."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Role model: ${roleModelName}\nWeek starting: ${weekStart.toISOString()}\nCandidates: ${JSON.stringify(
                  deduped
                )}\nReturn JSON with shape {summaryText: string, topics: string[], items: [{sourceTitle, sourceUrl, sourceType, sourceDate, summary}]}. summaryText must be ONE sentence (18-28 words) that synthesizes the week's dominant theme and names one specific event, decision, or statement from the candidates. Do not list multiple headlines, do not chain clauses with commas, and do not repeat the role model name more than once. Provide 3-5 topics (short noun phrases). Pick 6-10 items. If any candidates include sourceType \"video\" or YouTube links, include at least one video item. If any candidates include sourceType \"social\" or social links, include 1-3 social items.`
              }
            ]
          }
        ],
        temperature: 0.4,
        max_output_tokens: 800,
        text: { format: { type: "json_object" } }
      })
    });
  } catch (error) {
    console.error("AI digest generation failed", error);
    return buildFallback(deduped, roleModelName);
  }

  if (!response.ok) {
    console.error("AI digest generation failed", await response.text());
    return buildFallback(deduped, roleModelName);
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    console.error("AI digest response parsing failed", error);
    return buildFallback(deduped, roleModelName);
  }
  const content = extractOutputText(data);
  const parsed = safeJsonParse(content);
  if (!parsed) {
    console.error("Invalid AI response format");
    return buildFallback(deduped, roleModelName);
  }

  const summaryText = normalizeSummary(parsed.summaryText, roleModelName);
  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.map((topic) => `${topic}`.trim()).filter(Boolean).slice(0, 6)
    : [];
  const takeaways = [];

  let items = Array.isArray(parsed.items) ? parsed.items : [];
  const itemsByUrl = new Set(
    items.map((item) => (item?.sourceUrl || "").toLowerCase()).filter(Boolean)
  );
  const hasVideo = items.some(
    (item) => item?.sourceType === "video" || isVideoUrl(item?.sourceUrl)
  );
  const hasSocial = items.some(
    (item) => item?.sourceType === "social" || isSocialUrl(item?.sourceUrl)
  );

  if (!hasVideo && videoCandidates.length) {
    const fallbackVideo = mapCandidateToItem(videoCandidates[0]);
    const key = (fallbackVideo.sourceUrl || "").toLowerCase();
    if (key && !itemsByUrl.has(key)) {
      items.push(fallbackVideo);
      itemsByUrl.add(key);
    }
  }

  if (!hasSocial && socialCandidates.length) {
    for (const candidate of socialCandidates.slice(0, 2)) {
      const fallbackSocial = mapCandidateToItem(candidate);
      const key = (fallbackSocial.sourceUrl || "").toLowerCase();
      if (key && !itemsByUrl.has(key)) {
        items.push(fallbackSocial);
        itemsByUrl.add(key);
      }
    }
  }

  if (items.length > 12) {
    items = items.slice(0, 12);
  }

  return {
    summaryText,
    topics,
    takeaways,
    items: items.map((item) => {
      const sourceUrl = item.sourceUrl;
      const sourceType = isVideoUrl(sourceUrl)
        ? "video"
        : isSocialUrl(sourceUrl)
        ? "social"
        : item.sourceType || "web";
      return {
        sourceTitle: item.sourceTitle,
        sourceUrl,
        sourceType,
        sourceDate: item.sourceDate,
        summary: item.summary || "Update captured from the weekly scan.",
        contentHash: hashContent(`${item.sourceTitle}|${item.summary}`)
      };
    })
  };
}
