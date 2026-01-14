import { useEffect, useRef, useState } from "react";
import { getDigests, runDigest, updatePreferences } from "../api.js";

const SOCIAL_SCRIPT_SOURCES = {
  x: "https://platform.twitter.com/widgets.js",
  instagram: "https://www.instagram.com/embed.js",
  tiktok: "https://www.tiktok.com/embed.js"
};

const socialScriptCache = new Map();

function loadScriptOnce(id, src, readyCheck) {
  if (!src) return Promise.resolve();
  if (socialScriptCache.has(id)) return socialScriptCache.get(id);
  const existing = document.getElementById(id);
  const promise = new Promise((resolve, reject) => {
    if (readyCheck && readyCheck()) {
      resolve();
      return;
    }
    const script = existing || document.createElement("script");
    const timeout = setTimeout(() => resolve(), 1500);
    const onLoad = () => resolve();
    const onError = () => reject(new Error(`Failed to load ${src}`));
    script.addEventListener(
      "load",
      () => {
        clearTimeout(timeout);
        onLoad();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        onError();
      },
      { once: true }
    );
    if (!existing) {
      script.id = id;
      script.src = src;
      script.async = true;
      document.body.appendChild(script);
    }
  });
  socialScriptCache.set(id, promise);
  return promise;
}

function formatWeekLabel(weekStart) {
  const date = new Date(weekStart);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function getYouTubeId(url = "") {
  const match =
    url.match(/[?&]v=([^&]+)/) ||
    url.match(/youtu\.be\/([^?]+)/) ||
    url.match(/youtube\.com\/shorts\/([^?]+)/) ||
    url.match(/youtube\.com\/live\/([^?]+)/) ||
    url.match(/youtube\.com\/embed\/([^?]+)/);
  return match ? match[1] : "";
}

function normalizeUrl(rawUrl = "") {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const youTubeId = getYouTubeId(trimmed);
  if (youTubeId) {
    return `https://www.youtube.com/watch?v=${youTubeId}`;
  }
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "twitter.com") parsed.hostname = "x.com";
    if (hostname === "m.facebook.com" || hostname === "mbasic.facebook.com") {
      parsed.hostname = "www.facebook.com";
    }
    if (hostname === "facebook.com") parsed.hostname = "www.facebook.com";
    if (hostname === "m.instagram.com") parsed.hostname = "www.instagram.com";
    const params = parsed.searchParams;
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "mc_cid",
      "mc_eid"
    ].forEach((param) => params.delete(param));
    parsed.search = params.toString() ? `?${params.toString()}` : "";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch (error) {
    return trimmed.toLowerCase();
  }
}

function getSocialProvider(url = "") {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("x.com") || lowerUrl.includes("twitter.com")) return "x";
  if (lowerUrl.includes("instagram.com")) return "instagram";
  if (lowerUrl.includes("facebook.com") || lowerUrl.includes("fb.watch")) return "facebook";
  if (lowerUrl.includes("tiktok.com")) return "tiktok";
  if (lowerUrl.includes("bsky.app")) return "bluesky";
  if (lowerUrl.includes("linkedin.com")) return "linkedin";
  return "";
}

function getItemType(item) {
  const resolvedType = item.sourceType || "web";
  if (resolvedType === "video" || getYouTubeId(item.sourceUrl)) {
    return "video";
  }
  if (resolvedType === "social" || getSocialProvider(item.sourceUrl)) {
    return "social";
  }
  return resolvedType;
}

function isFacebookVideo(url = "") {
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes("/videos/") || lowerUrl.includes("video.php") || lowerUrl.includes("fb.watch");
}

function normalizeFacebookUrl(url = "") {
  if (!url) return "";
  return url
    .replace("m.facebook.com", "www.facebook.com")
    .replace("mbasic.facebook.com", "www.facebook.com");
}

function isEmbeddablePost(provider, url = "") {
  const lowerUrl = url.toLowerCase();
  if (provider === "x") {
    return lowerUrl.includes("/status/");
  }
  if (provider === "instagram") {
    return lowerUrl.includes("/p/") || lowerUrl.includes("/reel/") || lowerUrl.includes("/tv/");
  }
  if (provider === "facebook") {
    if (lowerUrl.includes("sharer.php") || lowerUrl.includes("/share/")) {
      return false;
    }
    if (lowerUrl.includes("fb.watch")) {
      return false;
    }
    return (
      lowerUrl.includes("/posts/") ||
      lowerUrl.includes("/videos/") ||
      lowerUrl.includes("/photo.php") ||
      lowerUrl.includes("/permalink.php") ||
      lowerUrl.includes("/watch/?v=") ||
      lowerUrl.includes("story.php") ||
      lowerUrl.includes("video.php")
    );
  }
  if (provider === "tiktok") {
    return lowerUrl.includes("/video/");
  }
  if (provider === "bluesky") {
    return lowerUrl.includes("/post/");
  }
  if (provider === "linkedin") {
    return lowerUrl.includes("/posts/") || lowerUrl.includes("/feed/update/");
  }
  return false;
}

function getItemKey(item) {
  const normalizedUrl = normalizeUrl(item.sourceUrl || "");
  if (normalizedUrl) return `url:${normalizedUrl}`;
  const title = (item.sourceTitle || "").trim().toLowerCase();
  const summary = (item.summary || "").trim().toLowerCase();
  if (title || summary) return `text:${title}|${summary}`;
  if (item.id) return `id:${item.id}`;
  const fallback = JSON.stringify({
    date: item.sourceDate || "",
    type: item.sourceType || "",
    title: item.sourceTitle || "",
    summary: item.summary || ""
  });
  return `fallback:${fallback.toLowerCase()}`;
}

function dedupeDigestItems(items) {
  const result = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = getItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function SocialEmbed({ provider, url }) {
  if (!provider || !url) return null;
  if (provider === "x") {
    return (
      <blockquote
        className="twitter-tweet"
        data-conversation="none"
        data-cards="hidden"
        data-dnt="true"
      >
        <a href={url} target="_blank" rel="noreferrer">
          View post
        </a>
      </blockquote>
    );
  }
  if (provider === "instagram") {
    return (
      <blockquote
        className="instagram-media"
        data-instgrm-permalink={url}
        data-instgrm-version="14"
      >
        <a href={url} target="_blank" rel="noreferrer">
          View post
        </a>
      </blockquote>
    );
  }
  if (provider === "facebook") {
    const normalizedUrl = normalizeFacebookUrl(url);
    const isVideo = isFacebookVideo(normalizedUrl) || normalizedUrl.includes("/watch/?v=");
    const embedUrl = isVideo
      ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
          normalizedUrl
        )}&show_text=true&width=500`
      : `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(
          normalizedUrl
        )}&show_text=true&width=500`;
    return (
      <iframe
        className={isVideo ? "facebook-embed is-video" : "facebook-embed"}
        src={embedUrl}
        title="Facebook post"
        scrolling="no"
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        allowFullScreen={isVideo}
      />
    );
  }
  if (provider === "tiktok") {
    const match = url.match(/video\/(\d+)/);
    return (
      <blockquote
        className="tiktok-embed"
        cite={url}
        data-video-id={match ? match[1] : ""}
      >
        <a href={url} target="_blank" rel="noreferrer">
          View post
        </a>
      </blockquote>
    );
  }
  if (provider === "bluesky") {
    const embedUrl = `https://embed.bsky.app/embed?url=${encodeURIComponent(url)}`;
    return (
      <iframe
        className="bluesky-embed"
        src={embedUrl}
        title="Bluesky post"
        loading="lazy"
      />
    );
  }
  return null;
}

export default function DigestPage({ user, roleModel, onUserUpdate }) {
  const [digests, setDigests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(user.weeklyEmailOptIn ?? true);
  const autoRunRef = useRef({ roleModelKey: null, attempted: false });
  const currentDigest = digests[0];
  const digestItems = currentDigest?.items || [];

  useEffect(() => {
    let isMounted = true;
    getDigests()
      .then((data) => {
        if (!isMounted) return;
        setDigests(data.digests || []);
      })
      .catch(() => null)
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!digestItems.length) return;
    const providers = new Set(
      digestItems.map((item) => getSocialProvider(item.sourceUrl)).filter(Boolean)
    );
    if (!providers.size) return;

    const refreshEmbeds = () => {
      if (providers.has("x")) {
        window.twttr?.widgets?.load();
      }
      if (providers.has("instagram")) {
        window.instgrm?.Embeds?.process();
      }
      if (providers.has("tiktok")) {
        window.tiktok?.load();
      }
    };

    const loadEmbeds = async () => {
      const tasks = [];
      if (providers.has("x")) {
        tasks.push(
          loadScriptOnce("embed-x", SOCIAL_SCRIPT_SOURCES.x, () => !!window.twttr)
        );
      }
      if (providers.has("instagram")) {
        tasks.push(
          loadScriptOnce("embed-instagram", SOCIAL_SCRIPT_SOURCES.instagram, () => !!window.instgrm)
        );
      }
      if (providers.has("tiktok")) {
        tasks.push(
          loadScriptOnce("embed-tiktok", SOCIAL_SCRIPT_SOURCES.tiktok, () => !!window.tiktok)
        );
      }
      try {
        await Promise.all(tasks);
      } catch (error) {
        // Best-effort embed loading.
      }
      let attempts = 0;
      const refreshLoop = () => {
        attempts += 1;
        refreshEmbeds();
        if (attempts < 6) {
          setTimeout(refreshLoop, 300);
        }
      };
      refreshLoop();
    };

    loadEmbeds();
  }, [digestItems]);

  const handleRunDigest = async (options) => {
    const isEvent = options && typeof options === "object" && "preventDefault" in options;
    const initialStatus = !isEvent && options?.initialStatus ? options.initialStatus : null;
    setRunning(true);
    setStatus(initialStatus);
    try {
      const data = await runDigest();
      setDigests(data.digests || []);
      setStatus("Fresh digest generated.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    const roleModelKey = roleModel?.id || roleModel?.name || null;
    if (!roleModelKey) return;
    if (autoRunRef.current.roleModelKey !== roleModelKey) {
      autoRunRef.current.roleModelKey = roleModelKey;
      autoRunRef.current.attempted = false;
    }
    if (loading || running) return;
    if (digests.length > 0) return;
    if (autoRunRef.current.attempted) return;
    autoRunRef.current.attempted = true;
    handleRunDigest({ initialStatus: "Generating your first digest..." });
  }, [digests.length, loading, roleModel, running]);

  const handleToggleEmail = async () => {
    const nextValue = !emailOptIn;
    setEmailOptIn(nextValue);
    try {
      const data = await updatePreferences({ weeklyEmailOptIn: nextValue });
      onUserUpdate(data.user);
    } catch (error) {
      setStatus(error.message);
      setEmailOptIn(!nextValue);
    }
  };

  const handleShareDigest = async () => {
    if (!currentDigest?.id) return;
    const url = `${window.location.origin}/digest/share/${currentDigest.id}`;
    const shareData = {
      title: `${roleModel?.name} digest`,
      text: currentDigest.summaryText || "",
      url
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Digest link copied.");
    } catch (error) {
      setStatus(`Digest link: ${url}`);
    }
  };

  const uniqueItems = dedupeDigestItems(digestItems);
  const videoItem = uniqueItems.find(
    (item) => item.sourceType === "video" || getYouTubeId(item.sourceUrl)
  );
  const videoId = videoItem ? getYouTubeId(videoItem.sourceUrl) : "";
  const spotlightKey = videoItem ? getItemKey(videoItem) : "";
  const listItems = uniqueItems.filter((item) => getItemKey(item) !== spotlightKey);
  const groupedItems = listItems.reduce((acc, item) => {
    const key = getItemType(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
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

  return (
    <div className="page digest-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Digest</p>
          <h2>{roleModel?.name}</h2>
        </div>
      </header>

      {status ? <p className="status">{status}</p> : null}
      {running ? <p className="status pending">Assembling the weekly signal</p> : null}

      <section className="card digest-hero">
        <div className="card-header">
          <h3>This week</h3>
          <p className="muted">
            Auto-generated every Monday at 8:00 AM.
          </p>
        </div>
        {loading ? (
          <p className="muted">Loading digest...</p>
        ) : currentDigest ? (
          <div className="digest-overview">
            <p className="digest-date">Week of {formatWeekLabel(currentDigest.weekStart)}</p>
            <p className="digest-theme">{currentDigest.summaryText}</p>
            {videoItem ? (
              <div className="digest-video">
                {videoId ? (
                  <img
                    src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                    alt={videoItem.sourceTitle}
                  />
                ) : null}
                <div>
                  <p className="eyebrow">Video spotlight</p>
                  <p className="item-title">{videoItem.sourceTitle}</p>
                  <p className="item-summary">{videoItem.summary}</p>
                  {videoItem.sourceUrl ? (
                    <a href={videoItem.sourceUrl} target="_blank" rel="noreferrer">
                      Watch on YouTube
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="digest-stream">
              {typeOrder.map((type) => {
                const items = groupedItems[type] || [];
                if (!items.length) return null;
                return (
                  <div key={type} className="digest-section">
                    <h4>{typeLabels[type] || type}</h4>
                    <div className="digest-items">
                      {items.map((item) => {
                        const provider = getSocialProvider(item.sourceUrl);
                        const canEmbed = ["x", "instagram", "facebook", "tiktok", "bluesky"].includes(provider);
                        const shouldEmbed =
                          type === "social" && canEmbed && isEmbeddablePost(provider, item.sourceUrl);
                        const isSocial = type === "social";
                        const summaryText = `${item.summary || ""}`.trim();
                        const socialSummary =
                          summaryText || "Open the post to view the full update.";
                        const showActionLink = !!item.sourceUrl;
                        return (
                          <article key={item.id} className="digest-item">
                            <div className="item-meta">
                              <span className={`item-type ${type}`}>
                                {typeLabels[type] || type}
                              </span>
                              {item.sourceDate ? (
                                <span className="item-date">{item.sourceDate}</span>
                              ) : null}
                              {item.isOfficial ? (
                                <span className="item-official">Official</span>
                              ) : null}
                            </div>
                            {shouldEmbed ? (
                              <>
                                <p className="item-summary social-summary">{socialSummary}</p>
                                <div className={`social-embed ${provider ? `social-embed-${provider}` : ""}`}>
                                  <SocialEmbed provider={provider} url={item.sourceUrl} />
                                </div>
                              </>
                            ) : isSocial ? (
                              <p className="item-summary social-summary">{socialSummary}</p>
                            ) : (
                              <>
                                <p className="item-title">{item.sourceTitle}</p>
                                <p className="item-summary">{item.summary}</p>
                              </>
                            )}
                            {showActionLink && item.sourceUrl ? (
                              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                {actionLabels[type] || "Source"}
                              </a>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {!digestItems.length ? (
                <p className="muted">No weekly items found yet.</p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="muted">No digest yet. Generate one to get started.</p>
        )}
      </section>

      <div className="header-actions">
        {currentDigest ? (
          <button className="secondary" type="button" onClick={handleShareDigest}>
            Share
          </button>
        ) : null}
        <button
          className="secondary"
          type="button"
          onClick={handleRunDigest}
          disabled={running}
        >
          {running ? "Generating..." : "Generate now"}
        </button>
        <label className="toggle-switch">
          <input type="checkbox" checked={emailOptIn} onChange={handleToggleEmail} />
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-thumb" />
          </span>
          <span className="toggle-state">{emailOptIn ? "On" : "Off"}</span>
          <span className="toggle-label">Weekly email</span>
        </label>
      </div>

      <section className="card digest-history">
        <div className="card-header">
          <h3>Archive</h3>
        </div>
        <div className="digest-grid">
          {digests.slice(1).map((digest) => (
            <div key={digest.id} className="digest-week">
              <p className="digest-date">Week of {formatWeekLabel(digest.weekStart)}</p>
              <p>{digest.summaryText}</p>
            </div>
          ))}
          {digests.length <= 1 ? (
            <p className="muted">Past weeks will collect here.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
