import "../env.js";
import { fetchSourceText } from "./sourceAgent.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_ITEMS = 10;
const MAX_CONTENT_CHARS = 12000;

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

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function cleanTitle(value) {
  return `${value || ""}`
    .replace(/\s+-\s+[^-]{2,40}$/g, "")
    .replace(/\s+\|\s+[^|]{2,40}$/g, "")
    .replace(/(\.\.\.|…)+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FALLBACK_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "amid",
  "around",
  "because",
  "before",
  "being",
  "could",
  "during",
  "first",
  "from",
  "have",
  "into",
  "latest",
  "more",
  "news",
  "over",
  "public",
  "says",
  "than",
  "that",
  "their",
  "there",
  "they",
  "this",
  "update",
  "updates",
  "week",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would"
]);

function extractFallbackTopics(items, roleModelName) {
  const nameTokens = new Set(
    `${roleModelName || ""}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
  const counts = new Map();
  const firstSeen = new Map();
  let index = 0;

  for (const item of items.slice(0, MAX_ITEMS)) {
    const text = `${item.sourceTitle || ""} ${item.summary || ""}`.toLowerCase();
    const words = text.match(/[a-z][a-z0-9'-]{3,}/g) || [];
    for (const rawWord of words) {
      const word = rawWord.replace(/^'+|'+$/g, "");
      if (!word || FALLBACK_STOPWORDS.has(word) || nameTokens.has(word)) continue;
      if (!firstSeen.has(word)) firstSeen.set(word, index++);
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return firstSeen.get(a[0]) - firstSeen.get(b[0]);
    })
    .slice(0, 4)
    .map(([word]) => word);
}

function formatTopicList(topics) {
  if (topics.length <= 1) return topics[0] || "recent coverage";
  if (topics.length === 2) return `${topics[0]} and ${topics[1]}`;
  return `${topics.slice(0, -1).join(", ")}, and ${topics.at(-1)}`;
}

function buildFallbackSummary(items, roleModelName) {
  const topics = extractFallbackTopics(Array.isArray(items) ? items : [], roleModelName);
  if (topics.length) {
    return `This week surfaced ${roleModelName} updates around ${formatTopicList(topics)}.`;
  }

  const titles = (Array.isArray(items) ? items : [])
    .map((item) => cleanTitle(item?.sourceTitle || ""))
    .filter(Boolean)
    .slice(0, 3);

  if (!titles.length) {
    return `No substantive public updates were found for ${roleModelName} this week.`;
  }

  if (titles.length === 1) {
    return `This week surfaced a public update about ${roleModelName}: ${titles[0]}.`;
  }

  const [first, second, third] = titles;
  return `This week surfaced ${roleModelName} updates around ${first} and ${second}${
    third ? `, with additional coverage of ${third}` : ""
  }.`;
}

function isWeakSummary(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return true;
  if (trimmed.split(/\s+/).length < 12) return true;
  const lower = trimmed.toLowerCase();
  const generic = [
    "latest updates",
    "fresh mentions",
    "public updates",
    "mixed signals",
    "quiet signal"
  ];
  return generic.some((phrase) => lower.includes(phrase));
}

function labelCatchUp(summary, items) {
  const isCatchUp = items.some((item) => /^Catch-up \(published /i.test(item.summary || ""));
  if (!isCatchUp || /catch(?:ing)?[ -]?up/i.test(summary)) return summary;
  return `Catch-up: ${summary.replace(/^This week,?\s*/i, "")}`;
}

export async function generateDigestSummary({ roleModelName, items }) {
  const safeItems = Array.isArray(items) ? items.slice(0, MAX_ITEMS) : [];
  if (!safeItems.length) {
    return buildFallbackSummary([], roleModelName);
  }

  if (!OPENAI_API_KEY) {
    return labelCatchUp(buildFallbackSummary(safeItems, roleModelName), safeItems);
  }

  const contexts = await Promise.all(
    safeItems.map(async (item, index) => {
      const content = item.isOfficial ? "" : await fetchSourceText(item.sourceUrl, MAX_CONTENT_CHARS);
      return {
        id: index,
        title: item.sourceTitle || "",
        url: item.sourceUrl || "",
        sourceType: item.sourceType || "web",
        sourceDate: item.sourceDate || "",
        summary: item.summary || "",
        activityKind: item.activityKind || "published",
        content: content || ""
      };
    })
  );

  const response = await fetch(OPENAI_ENDPOINT, {
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
                "You are a weekly digest editor helping a reader follow a person's work and activity. Use only the provided item metadata and public content. Respect original dates: older undelivered work is catch-up, upcoming events are scheduled and have not occurred, and ongoing channels are context. Never imply every item was published this week. Explicitly acknowledge catch-up or upcoming events when present. Write one sentence (20-32 words) that synthesizes the week's dominant theme(s). Be specific and cite at least two concrete developments if present. Do not list headlines."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Role model: ${roleModelName}\nItems: ${JSON.stringify(
                contexts
              )}\nReturn JSON with shape {summaryText: string}.`
            }
          ]
        }
      ],
      temperature: 0.2,
      max_output_tokens: 200,
      text: { format: { type: "json_object" } }
    })
  });

  if (!response.ok) {
    return labelCatchUp(buildFallbackSummary(safeItems, roleModelName), safeItems);
  }

  const data = await response.json();
  const content = extractOutputText(data);
  const parsed = safeJsonParse(content);
  const summaryText = parsed?.summaryText ? `${parsed.summaryText}`.trim() : "";
  if (isWeakSummary(summaryText)) {
    return labelCatchUp(buildFallbackSummary(safeItems, roleModelName), safeItems);
  }
  return labelCatchUp(summaryText, safeItems);
}
