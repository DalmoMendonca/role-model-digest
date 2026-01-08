import "../env.js";
import { collectBioSources } from "./sourceAgent.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const MIN_BIO_SOURCES = 2;
const MIN_STRONG_SOURCES = 1;

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

function formatSources(sources) {
  return sources
    .map(
      (item, index) =>
        `[${index + 1}] [${item.sourceType || "web"}] ${item.title || "Source"} - ${
          item.snippet || "No snippet"
        } (${item.url || "no url"})`
    )
    .join("\n");
}
export async function generateBio({ name }) {
  let sources = [];
  try {
    sources = await collectBioSources({ roleModelName: name });
  } catch (error) {
    console.warn("Bio source collection failed", error);
  }

  if (!sources.length) {
    return {
      bioText: `We couldn't find enough public sources to write a verified bio for ${name}.`
    };
  }

  const strongSources = sources.filter((item) => item.isStrong);
  if (strongSources.length < MIN_STRONG_SOURCES) {
    return {
      bioText: `We couldn't find enough verified public sources to write a reliable bio for ${name}.`
    };
  }

  if (!OPENAI_API_KEY) {
    return {
      bioText: "Bio unavailable right now. Configure an OpenAI API key to generate it."
    };
  }

  let sourcesForPrompt = strongSources;
  if (sourcesForPrompt.length < MIN_BIO_SOURCES) {
    const supplemental = sources
      .filter((item) => !item.isStrong)
      .slice(0, MIN_BIO_SOURCES - sourcesForPrompt.length);
    sourcesForPrompt = [...sourcesForPrompt, ...supplemental];
  }
  const limitedSources =
    sourcesForPrompt.length < MIN_BIO_SOURCES ||
    sourcesForPrompt.every((item) => (item.snippet || "").length < 80);
  const sourcesText = formatSources(sourcesForPrompt.slice(0, 8));

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
                "You write concise, elegant, accurate bios in an editorial voice. Use only facts present in the provided sources. Avoid speculation or fictionalization."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Role model: ${name}\nSources:\n${sourcesText}\n\n${
                limitedSources
                  ? "Write a brief 4-5 sentence profile using only the sources. Say explicitly when public details are limited and do not guess."
                  : "Write a 2-paragraph bio that only uses the sources. Make it stylish but factual and grounded. End with a single-line takeaway about what makes their work distinctive."
              } Never infer dates, follower counts, locations, or roles unless they appear in the sources. If the sources are insufficient, say so plainly.`
            }
          ]
        }
      ],
      temperature: 0.2,
      max_output_tokens: 300
    })
  });

  if (!response.ok) {
    throw new Error("AI bio generation failed");
  }

  const data = await response.json();
  const bioText = extractOutputText(data);

  return { bioText: bioText || "" };
}

