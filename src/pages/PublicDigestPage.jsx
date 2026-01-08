import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPublicDigest } from "../api.js";

function formatWeekLabel(weekStart) {
  if (!weekStart) return "";
  const date = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(date.getTime())) return weekStart;
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

function getItemType(item) {
  const resolvedType = item.sourceType || "web";
  if (resolvedType === "video" || getYouTubeId(item.sourceUrl)) {
    return "video";
  }
  return resolvedType;
}

function buildShareUrl(digestId) {
  if (!digestId) return "";
  return `${window.location.origin}/digest/share/${digestId}`;
}

export default function PublicDigestPage() {
  const { digestId } = useParams();
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setStatus(null);
    getPublicDigest(digestId)
      .then((data) => {
        if (!isMounted) return;
        setDigest(data.digest || null);
      })
      .catch((error) => {
        if (!isMounted) return;
        setStatus(error.message);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [digestId]);

  const handleShare = async () => {
    if (!digest?.id) return;
    const url = buildShareUrl(digest.id);
    const shareData = {
      title: `${digest.roleModelName} digest`,
      text: digest.summaryText || "",
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

  const items = digest?.items || [];
  const groupedItems = items.reduce((acc, item) => {
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
    <div className="public-shell">
      <div className="page digest-page digest-public">
        <header className="page-header">
          <div className="public-title">
            <p className="eyebrow">Digest</p>
            <h2>{digest?.roleModelName || "Role Model Digest"}</h2>
          </div>
          <div className="public-actions">
            <button
              className="secondary"
              type="button"
              onClick={handleShare}
              disabled={!digest?.id}
            >
              Share
            </button>
            <a className="secondary" href="/social">
              Social
            </a>
          </div>
        </header>

        {status ? <p className="status">{status}</p> : null}

        <section className="card digest-hero">
          <div className="card-header">
            <h3>This week</h3>
            <p className="muted">Role Model Digest</p>
          </div>
          {loading ? (
            <p className="muted">Loading digest...</p>
          ) : digest ? (
            <div className="digest-overview">
              <p className="digest-date">Week of {formatWeekLabel(digest.weekStart)}</p>
              <p className="digest-theme">{digest.summaryText}</p>
              <div className="digest-stream">
                {typeOrder.map((type) => {
                  const sectionItems = groupedItems[type] || [];
                  if (!sectionItems.length) return null;
                  return (
                    <div key={type} className="digest-section">
                      <h4>{typeLabels[type] || type}</h4>
                      <div className="digest-items">
                        {sectionItems.map((item) => (
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
                            <p className="item-title">{item.sourceTitle || "Update"}</p>
                            <p className="item-summary">{item.summary}</p>
                            {item.sourceUrl ? (
                              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                {actionLabels[type] || "Source"}
                              </a>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {!items.length ? <p className="muted">No weekly items found.</p> : null}
              </div>
            </div>
          ) : (
            <p className="muted">Digest not found.</p>
          )}
        </section>
      </div>
    </div>
  );
}
