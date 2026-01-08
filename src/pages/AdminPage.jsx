import { useEffect, useMemo, useState } from "react";
import { getAdminOverview } from "../api.js";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setStatus(null);
    getAdminOverview()
      .then((response) => {
        if (!isMounted) return;
        setData(response);
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
  }, []);

  const users = data?.users || [];
  const summary = data?.summary || {};

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) =>
      `${a.email || ""}`.localeCompare(b.email || "")
    );
  }, [users]);

  return (
    <div className="page admin-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Everything at a glance</h2>
        </div>
      </header>

      {status ? <p className="status error">{status}</p> : null}
      {loading ? <p className="muted">Loading admin overview...</p> : null}

      {!loading ? (
        <>
          <section className="admin-metrics">
            <div className="card metric-card">
              <p className="metric-label">Users</p>
              <p className="metric-value">{summary.userCount || 0}</p>
            </div>
            <div className="card metric-card">
              <p className="metric-label">Role models</p>
              <p className="metric-value">{summary.roleModelCount || 0}</p>
            </div>
            <div className="card metric-card">
              <p className="metric-label">Digests</p>
              <p className="metric-value">{summary.digestCount || 0}</p>
            </div>
            <div className="card metric-card">
              <p className="metric-label">Connections</p>
              <p className="metric-value">{summary.peerConnectionCount || 0}</p>
            </div>
            <div className="card metric-card">
              <p className="metric-label">Pending requests</p>
              <p className="metric-value">{summary.pendingRequestCount || 0}</p>
            </div>
          </section>

          <section className="admin-users">
            {sortedUsers.map((user) => (
              <div key={user.id} className="card admin-user-card">
                <div className="admin-user-header">
                  <div>
                    <p className="admin-user-name">
                      {user.displayName || "Unnamed user"}
                    </p>
                    <p className="muted">{user.email}</p>
                  </div>
                  <div className="admin-user-meta">
                    <span>Joined: {formatDate(user.createdAt) || "Unknown"}</span>
                    <span>Timezone: {user.timezone || "Unset"}</span>
                    <span>Email digest: {user.weeklyEmailOptIn ? "On" : "Off"}</span>
                  </div>
                </div>

                <div className="admin-section">
                  <h4>Role models</h4>
                  {user.roleModels?.length ? (
                    <div className="admin-list">
                      {user.roleModels.map((role) => (
                        <div key={role.id} className="admin-row">
                          <div>
                            <p className="admin-row-title">
                              {role.name || "Untitled"}
                            </p>
                            <p className="muted">
                              Created {formatDate(role.createdAt) || "Unknown"}
                            </p>
                            {role.bioText || role.notesText ? (
                              <details className="admin-inline-details">
                                <summary>Bio &amp; Notes</summary>
                                {role.bioText ? (
                                  <p className="muted">{role.bioText}</p>
                                ) : (
                                  <p className="muted">No bio yet.</p>
                                )}
                                {role.notesText ? (
                                  <p className="muted">{role.notesText}</p>
                                ) : (
                                  <p className="muted">No notes yet.</p>
                                )}
                              </details>
                            ) : null}
                          </div>
                          <div className="admin-row-meta">
                            {role.isActive ? (
                              <span className="admin-pill active">Active</span>
                            ) : (
                              <span className="admin-pill">Inactive</span>
                            )}
                            <span className="admin-pill">
                              Digests {role.digests?.length || 0}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No role models yet.</p>
                  )}
                </div>

                <div className="admin-section">
                  <h4>Digests</h4>
                  {user.digests?.length ? (
                    <div className="admin-digest-list">
                      {user.digests.map((digest) => (
                        <details key={digest.id} className="admin-digest">
                          <summary>
                            <span>
                              Week of {formatDate(digest.weekStart) || digest.weekStart || "Unknown"}
                            </span>
                            <span className="admin-summary-count">
                              {digest.items?.length || 0} items
                            </span>
                          </summary>
                          <p className="muted">
                            Generated {formatDateTime(digest.generatedAt) || "Unknown"}
                          </p>
                          <p>{digest.summaryText || "No summary available."}</p>
                          {digest.items?.length ? (
                            <div className="admin-item-list">
                              {digest.items.map((item, index) => {
                                const typeLabel = `${item.sourceType || "web"}`.toLowerCase();
                                return (
                                  <div key={`${digest.id}-${index}`} className="admin-item">
                                    <span className={`item-type ${typeLabel}`}>
                                      {typeLabel}
                                    </span>
                                    <div className="admin-item-main">
                                      <p className="admin-item-title">
                                        {item.sourceTitle || "Untitled"}
                                      </p>
                                      <p className="muted">{item.summary || ""}</p>
                                      {item.sourceUrl ? (
                                        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                          Source
                                        </a>
                                      ) : null}
                                    </div>
                                    <span className="admin-item-date">
                                      {formatDate(item.sourceDate) || item.sourceDate || ""}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="muted">No items captured.</p>
                          )}
                        </details>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No digests yet.</p>
                  )}
                </div>

                <div className="admin-section">
                  <h4>Connections</h4>
                  {user.peers?.length ? (
                    <div className="admin-pill-group">
                      {user.peers.map((peer) => (
                        <div key={peer.id} className="admin-peer">
                          <p>{peer.displayName || "Unnamed"}</p>
                          <p className="muted">{peer.email || ""}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No peers yet.</p>
                  )}
                </div>

                <div className="admin-section">
                  <h4>Requests</h4>
                  <div className="admin-requests">
                    <div>
                      <p className="eyebrow">Incoming</p>
                      {user.incomingRequests?.length ? (
                        user.incomingRequests.map((req) => (
                          <div key={req.id} className="admin-request-row">
                            <span>{req.requesterName || req.requesterEmail}</span>
                            <span className="muted">{req.status}</span>
                          </div>
                        ))
                      ) : (
                        <p className="muted">None.</p>
                      )}
                    </div>
                    <div>
                      <p className="eyebrow">Outgoing</p>
                      {user.outgoingRequests?.length ? (
                        user.outgoingRequests.map((req) => (
                          <div key={req.id} className="admin-request-row">
                            <span>{req.recipientName || req.recipientEmail}</span>
                            <span className="muted">{req.status}</span>
                          </div>
                        ))
                      ) : (
                        <p className="muted">None.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}
