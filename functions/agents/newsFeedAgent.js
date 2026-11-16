// A public, dated news index supplies an independent path without paid credits.
function decodeXml(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export async function collectNewsFeed({ roleModelName, since, until = new Date() }) {
  const query = `"${roleModelName.replace(/"/g, "")}" when:7d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`News feed returned HTTP ${response.status}`);
  const xml = await response.text();
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new Error("Invalid news feed");
  const field = (entry, name) => decodeXml((entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i")) || [])[1] || "");
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map((entry) => {
    const published = new Date(field(entry, "pubDate"));
    if (!Number.isFinite(published.getTime()) || published < since || published > until) return null;
    const title = field(entry, "title").trim();
    const link = field(entry, "link").trim();
    if (!title || !/^https?:\/\//i.test(link)) return null;
    return {
      title, url: link,
      snippet: field(entry, "description").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || title,
      sourceType: "news", date: published.toISOString().slice(0, 10),
      discoveryProvider: "google-news"
    };
  }).filter(Boolean).slice(0, 20);
}
