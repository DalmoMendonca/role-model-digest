import "../env.js";
import { fetchSourceText } from "./sourceAgent.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
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

function buildFallbackSummary(items, roleModelName) {
  const primary = items.find((item) => item?.summary || item?.sourceTitle);
  if (!primary) {
    return `This week focused on a quiet signal for ${roleModelName}.`;
  }
  const title = primary.sourceTitle || roleModelName;
  const summary = primary.summary ? ` ${primary.summary}` : "";
  return `This week focused on ${title}.${summary}`.trim();
}

function isWeakSummary(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return true;
  if (trimmed.split(/\s+/).length < 12) return true;
  const lower = trimmed.toLowerCase();
  const generic = ["latest updates", "fresh mentions", "public updates", "mixed signals"];
  return generic.some((phrase) => lower.includes(phrase));
}

export async function generateDigestSummary({ roleModelName, items }) {
  const safeItems = Array.isArray(items) ? items.slice(0, MAX_ITEMS) : [];
  if (!safeItems.length) {
    return buildFallbackSummary([], roleModelName);
  }

  if (!OPENAI_API_KEY) {
    return buildFallbackSummary(safeItems, roleModelName);
  }

  const contexts = await Promise.all(
    safeItems.map(async (item, index) => {
      const content = await fetchSourceText(item.sourceUrl, MAX_CONTENT_CHARS);
      return {
        id: index,
        title: item.sourceTitle || "",
        url: item.sourceUrl || "",
        sourceType: item.sourceType || "web",
        sourceDate: item.sourceDate || "",
        summary: item.summary || "",
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
                "You are a weekly digest editor. Use only the provided item metadata and full content. Write one sentence (20-32 words) that synthesizes the week's dominant theme(s). Be specific and cite at least two concrete developments if present. Do not list headlines."
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
    return buildFallbackSummary(safeItems, roleModelName);
  }

  const data = await response.json();
  const content = extractOutputText(data);
  const parsed = safeJsonParse(content);
  const summaryText = parsed?.summaryText ? `${parsed.summaryText}`.trim() : "";
  if (isWeakSummary(summaryText)) {
    return buildFallbackSummary(safeItems, roleModelName);
  }
  return summaryText;
}
