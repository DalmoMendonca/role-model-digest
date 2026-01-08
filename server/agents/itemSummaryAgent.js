import "../env.js";
import { fetchSourceText } from "./sourceAgent.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_ITEMS = 10;
const MIN_USEFUL_TEXT = 160;
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

function normalizeSummarySentence(text) {
  const trimmed = `${text || ""}`.trim();
  if (!trimmed) return "";
  const normalized = trimmed;
  if (!/[.!?]$/.test(normalized)) {
    return `${normalized}.`;
  }
  return normalized;
}

export async function summarizeDigestItems(items, roleModelName) {
  if (!OPENAI_API_KEY || !Array.isArray(items) || !items.length) {
    return items;
  }

  const contexts = await Promise.all(
    items.map(async (item, index) => {
      const shouldSummarize =
        item.sourceType === "news" ||
        item.sourceType === "web" ||
        item.sourceType === "custom";
      if (!shouldSummarize) {
        return null;
      }
      const text = await fetchSourceText(item.sourceUrl, MAX_CONTENT_CHARS);
      return {
        id: index,
        title: item.sourceTitle || "",
        url: item.sourceUrl || "",
        text: text || "",
        textLength: (text || "").length,
        fallback: item.summary || ""
      };
    })
  );

  const targets = contexts.filter(Boolean);
  if (!targets.length) {
    return items;
  }

  const summaryMap = new Map();
  for (let i = 0; i < targets.length; i += MAX_ITEMS) {
    const batch = targets.slice(i, i + MAX_ITEMS);
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
                  `You summarize articles into one informative sentence. Focus on the most important outcome or announcement. Avoid vague phrasing, hype, or repeats of the headline. If textLength is below ${MIN_USEFUL_TEXT} characters, use fallback if provided; if both are empty, reply with: Summary unavailable due to access limits.`
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Role model: ${roleModelName}\nItems: ${JSON.stringify(
                  batch
                )}\nReturn JSON with shape {items: [{id: number, summary: string}]}. Each summary must be one sentence that adds context beyond the headline.`
              }
            ]
          }
        ],
        temperature: 0.2,
        max_output_tokens: 800,
        text: { format: { type: "json_object" } }
      })
    });

    if (!response.ok) {
      continue;
    }

    const data = await response.json();
    const content = extractOutputText(data);
    const parsed = safeJsonParse(content);
    if (!parsed || !Array.isArray(parsed.items)) {
      continue;
    }

    for (const entry of parsed.items) {
      if (Number.isInteger(entry?.id) && entry?.summary) {
        summaryMap.set(entry.id, normalizeSummarySentence(entry.summary));
      }
    }
  }

  return items.map((item, index) => {
    if (summaryMap.has(index)) {
      return { ...item, summary: summaryMap.get(index) };
    }
    return item;
  });
}
