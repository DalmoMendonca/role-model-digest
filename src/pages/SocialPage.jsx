import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addDigestComment,
  addDigestReaction,
  getPeers,
  getSocialUsers,
  getTimeline,
  respondToRequest,
  sendPeerRequest
} from "../api.js";

const reactions = [
  { type: "like", icon: "fa-thumbs-up", label: "Like" },
  { type: "love", icon: "fa-heart", label: "Love" },
  { type: "laugh", icon: "fa-face-laugh-squint", label: "Laugh" },
  { type: "wow", icon: "fa-face-surprise", label: "Wow" },
  { type: "insightful", icon: "fa-lightbulb", label: "Insightful" },
  { type: "spicy", icon: "fa-fire", label: "Spicy" },
  { type: "charged", icon: "fa-bolt", label: "Charged" },
  { type: "star", icon: "fa-star", label: "Legendary" }
];

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

function getInitial(value) {
  const trimmed = `${value || ""}`.trim();
  if (!trimmed) return "?";
  return trimmed[0].toUpperCase();
}

function Avatar({ url, name, className }) {
  if (url) {
    return <img className={className} src={url} alt={name || "avatar"} referrerPolicy="no-referrer" />;
  }
  return <span className={`${className} avatar-fallback`}>{getInitial(name)}</span>;
}

function CommentThread({
  comments,
  digestId,
  replyDrafts,
  replyingTo,
  onReplyChange,
  onToggleReply,
  onSubmitReply,
  depth = 0
}) {
  if (!comments?.length) return null;
  return comments.map((comment) => (
    <div key={comment.id} className={`comment comment-depth-${depth}`}>
      <div className="comment-header">
        <Avatar
          className="comment-avatar"
          url={comment.user?.photoURL}
          name={comment.user?.displayName}
        />
        <div>
          <p className="comment-author">
            {comment.user?.displayName || "Someone"}
          </p>
          <p className="comment-time">{formatDateTime(comment.createdAt)}</p>
        </div>
      </div>
      <p className="comment-text">{comment.text}</p>
      <button
        className="ghost comment-reply"
        type="button"
        onClick={() => onToggleReply(comment.id)}
      >
        Reply
      </button>
      {replyingTo[comment.id] ? (
        <form
          className="comment-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitReply(digestId, comment.id);
          }}
        >
          <input
            type="text"
            value={replyDrafts[comment.id] || ""}
            onChange={(event) => onReplyChange(comment.id, event.target.value)}
            placeholder="Reply to this comment"
            required
          />
          <button className="secondary" type="submit">
            Send
          </button>
        </form>
      ) : null}
      {comment.replies?.length ? (
        <div className="comment-replies">
          <CommentThread
            comments={comment.replies}
            digestId={digestId}
            replyDrafts={replyDrafts}
            replyingTo={replyingTo}
            onReplyChange={onReplyChange}
            onToggleReply={onToggleReply}
            onSubmitReply={onSubmitReply}
            depth={depth + 1}
          />
        </div>
      ) : null}
    </div>
  ));
}

export default function SocialPage() {
  const [peers, setPeers] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [discoverUsers, setDiscoverUsers] = useState([]);
  const [email, setEmail] = useState("");
  const [filter, setFilter] = useState("");
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyingTo, setReplyingTo] = useState({});
  const [openReactionFor, setOpenReactionFor] = useState(null);

  const loadPeers = async () => {
    const peerData = await getPeers();
    setPeers(peerData.peers || []);
    setIncoming(peerData.incomingRequests || []);
    setOutgoing(peerData.outgoingRequests || []);
  };

  const loadTimeline = async (value) => {
    const timelineData = await getTimeline(value || "");
    setTimeline(timelineData.entries || []);
  };

  const loadDiscover = async (value) => {
    const userData = await getSocialUsers(value || "");
    setDiscoverUsers(userData.users || []);
  };

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    Promise.all([loadPeers(), loadTimeline(filter), loadDiscover(discoverQuery)])
      .catch(() => null)
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleRequest = async (event) => {
    event.preventDefault();
    setStatus(null);
    try {
      await sendPeerRequest({ email });
      setEmail("");
      setStatus("Request sent.");
      await Promise.all([loadPeers(), loadDiscover(discoverQuery)]);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleAddUser = async (userId) => {
    setStatus(null);
    try {
      await sendPeerRequest({ userId });
      setStatus("Request sent.");
      await Promise.all([loadPeers(), loadDiscover(discoverQuery)]);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleRespond = async (id, action) => {
    setStatus(null);
    try {
      await respondToRequest(id, action);
      await Promise.all([loadPeers(), loadTimeline(filter), loadDiscover(discoverQuery)]);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleFilter = async (value) => {
    setFilter(value);
    await loadTimeline(value);
  };

  const handleDiscoverSearch = async (value) => {
    setDiscoverQuery(value);
    await loadDiscover(value);
  };

  const handleReact = async (digestId, type) => {
    try {
      const data = await addDigestReaction(digestId, type);
      setTimeline((prev) =>
        prev.map((entry) =>
          entry.digestId === digestId ? { ...entry, reactions: data } : entry
        )
      );
      setOpenReactionFor(digestId);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleToggleReactions = (digestId) => {
    if (!digestId) return;
    setOpenReactionFor((prev) => (prev === digestId ? null : digestId));
  };

  const handleCommentChange = (digestId, value) => {
    setCommentDrafts((prev) => ({ ...prev, [digestId]: value }));
  };

  const handleReplyChange = (commentId, value) => {
    setReplyDrafts((prev) => ({ ...prev, [commentId]: value }));
  };

  const handleToggleReply = (commentId) => {
    setReplyingTo((prev) => ({ ...prev, [commentId]: !prev[commentId] }));
  };

  const handleSubmitComment = async (digestId, parentId = null) => {
    const text = parentId ? replyDrafts[parentId] || "" : commentDrafts[digestId] || "";
    if (!text.trim()) return;
    try {
      const data = await addDigestComment(digestId, { text, parentId });
      setTimeline((prev) =>
        prev.map((entry) =>
          entry.digestId === digestId ? { ...entry, comments: data.comments } : entry
        )
      );
      if (parentId) {
        setReplyDrafts((prev) => ({ ...prev, [parentId]: "" }));
        setReplyingTo((prev) => ({ ...prev, [parentId]: false }));
      } else {
        setCommentDrafts((prev) => ({ ...prev, [digestId]: "" }));
      }
    } catch (error) {
      setStatus(error.message);
    }
  };

  const sortedTimeline = useMemo(() => timeline || [], [timeline]);

  return (
    <div className="page social-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Social</p>
          <h2>More Role Models</h2>
        </div>
        <form className="inline-form" onSubmit={handleRequest}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Invite by email"
            required
          />
          <button className="primary" type="submit">
            Send request
          </button>
        </form>
      </header>

      {status ? <p className="status">{status}</p> : null}
      {loading ? <p className="muted">Loading social activity...</p> : null}

      <section className="card social-card">
        <div className="card-header">
          <div>
            <h3>Timeline</h3>
            <p className="muted">Latest digests from people you follow.</p>
          </div>
          <input
            className="filter-input"
            type="text"
            value={filter}
            onChange={(event) => handleFilter(event.target.value)}
            placeholder="Search the timeline"
          />
        </div>
        <div className="timeline">
          {sortedTimeline.map((entry) => {
            const digestId = entry.digestId || entry.id;
            const digestDate = entry.generatedAt || entry.weekStart || "";
            const reactionsByType = entry.reactions?.counts || {};
            const activeReactions = reactions.filter(
              (reaction) => (reactionsByType[reaction.type] || 0) > 0
            );
            const roleModelPath = entry.roleModelId ? `/social/role-model/${entry.roleModelId}` : null;
            return (
              <article key={digestId} className="timeline-entry">
                <div className="timeline-entry-header">
                  <div className="timeline-avatars">
                    <Avatar
                      className="avatar"
                      url={entry.peerPhotoURL}
                      name={entry.peerName}
                    />
                    {roleModelPath ? (
                      <Link className="role-avatar-link" to={roleModelPath}>
                        {entry.roleModelImageUrl ? (
                          <img
                            className="role-avatar"
                            src={entry.roleModelImageUrl}
                            alt={entry.roleModelName || "Role model"}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="role-avatar avatar-fallback">RM</span>
                        )}
                      </Link>
                    ) : entry.roleModelImageUrl ? (
                      <img
                        className="role-avatar"
                        src={entry.roleModelImageUrl}
                        alt={entry.roleModelName || "Role model"}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="role-avatar avatar-fallback">RM</span>
                    )}
                  </div>
                  <div className="timeline-entry-meta">
                    <p className="peer-name">{entry.peerName}</p>
                    {roleModelPath ? (
                      <Link className="muted role-model-link" to={roleModelPath}>
                        {entry.roleModelName || "No role model yet"}
                      </Link>
                    ) : (
                      <p className="muted">{entry.roleModelName || "No role model yet"}</p>
                    )}
                  </div>
                  <p className="timeline-date">{formatDateTime(digestDate)}</p>
                </div>
                <p className="timeline-summary">
                  {entry.summaryText || "No digest summary yet."}
                </p>
                <div className="reaction-bar">
                  <div className={`reaction-control ${openReactionFor === digestId ? "open" : ""}`}>
                    <button
                      className={`reaction-trigger ${
                        entry.reactions?.viewerReaction ? "active" : ""
                      }`}
                      type="button"
                      aria-label="React to digest"
                      disabled={!digestId}
                      onClick={() => handleToggleReactions(digestId)}
                    >
                      <i className="fa-solid fa-face-smile" aria-hidden="true" />
                      <span>React</span>
                    </button>
                    <div className="reaction-tray" role="group" aria-label="Choose a reaction">
                      {reactions.map((reaction) => (
                        <button
                          key={reaction.type}
                          className={`reaction-icon ${
                            entry.reactions?.viewerReaction === reaction.type ? "active" : ""
                          }`}
                          type="button"
                          title={reaction.label}
                          aria-label={reaction.label}
                          onClick={() => digestId && handleReact(digestId, reaction.type)}
                          disabled={!digestId}
                        >
                          <i className={`fa-solid ${reaction.icon}`} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </div>
                  {activeReactions.length ? (
                    <div className="reaction-summary">
                      {activeReactions.map((reaction) => (
                        <span key={reaction.type} className="reaction-count-pill">
                          <i className={`fa-solid ${reaction.icon}`} aria-hidden="true" />
                          <span>{reactionsByType[reaction.type]}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="comments">
                  <h4>Comments</h4>
                  {digestId ? (
                    <>
                      <form
                        className="comment-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          handleSubmitComment(digestId);
                        }}
                      >
                        <input
                          type="text"
                          value={commentDrafts[digestId] || ""}
                          onChange={(event) => handleCommentChange(digestId, event.target.value)}
                          placeholder="Add a comment"
                          required
                        />
                        <button className="secondary" type="submit">
                          Post
                        </button>
                      </form>
                      {entry.comments?.length ? (
                        <div className="comment-thread">
                          <CommentThread
                            comments={entry.comments}
                            digestId={digestId}
                            replyDrafts={replyDrafts}
                            replyingTo={replyingTo}
                            onReplyChange={handleReplyChange}
                            onToggleReply={handleToggleReply}
                            onSubmitReply={handleSubmitComment}
                          />
                        </div>
                      ) : (
                        <p className="muted">Be the first to comment.</p>
                      )}
                    </>
                  ) : (
                    <p className="muted">No digest to discuss yet.</p>
                  )}
                </div>
              </article>
            );
          })}
          {sortedTimeline.length === 0 ? (
            <p className="muted">No peer activity yet.</p>
          ) : null}
        </div>
      </section>

      <section className="card social-card">
        <div className="card-header">
          <div>
            <h3>Find peers</h3>
            <p className="muted">Search everyone on Role Model Digest.</p>
          </div>
          <input
            className="filter-input"
            type="text"
            value={discoverQuery}
            onChange={(event) => handleDiscoverSearch(event.target.value)}
            placeholder="Search by name"
          />
        </div>
        <div className="discover-list">
          {discoverUsers.map((user) => (
            <div key={user.id} className="discover-row">
              <Avatar className="avatar" url={user.photoURL} name={user.displayName} />
              <div className="discover-meta">
                <p className="peer-name">{user.displayName || "Unnamed"}</p>
                {user.roleModelId ? (
                  <Link className="muted role-model-link" to={`/social/role-model/${user.roleModelId}`}>
                    {user.roleModelName || "No role model yet"}
                  </Link>
                ) : (
                  <p className="muted">{user.roleModelName || "No role model yet"}</p>
                )}
              </div>
              {user.roleModelId ? (
                <Link className="role-avatar-link" to={`/social/role-model/${user.roleModelId}`}>
                  {user.roleModelImageUrl ? (
                    <img
                      className="role-avatar-inline"
                      src={user.roleModelImageUrl}
                      alt={user.roleModelName || "Role model"}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="role-avatar-inline avatar-fallback">RM</span>
                  )}
                </Link>
              ) : user.roleModelImageUrl ? (
                <img
                  className="role-avatar-inline"
                  src={user.roleModelImageUrl}
                  alt={user.roleModelName || "Role model"}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="role-avatar-inline avatar-fallback">RM</span>
              )}
              <div className="discover-actions">
                {user.relation === "connected" ? (
                  <span className="muted">Connected</span>
                ) : user.relation === "outgoing" ? (
                  <span className="muted">Request sent</span>
                ) : user.relation === "incoming" ? (
                  <span className="muted">Requested you</span>
                ) : (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => handleAddUser(user.id)}
                  >
                    Add
                  </button>
                )}
              </div>
            </div>
          ))}
          {discoverUsers.length === 0 ? (
            <p className="muted">No users found.</p>
          ) : null}
        </div>
      </section>

      <section className="card social-card">
        <div className="card-header">
          <h3>Your peers</h3>
        </div>
        <div className="peer-grid">
          {peers.map((peer) => (
            <div key={peer.id} className="peer-chip">
              <div className="peer-chip-header">
                <Avatar className="avatar" url={peer.photoURL} name={peer.displayName} />
                {peer.roleModelId ? (
                  <Link className="role-avatar-link" to={`/social/role-model/${peer.roleModelId}`}>
                    {peer.roleModelImageUrl ? (
                      <img
                        className="role-avatar-inline"
                        src={peer.roleModelImageUrl}
                        alt={peer.roleModelName || "Role model"}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="role-avatar-inline avatar-fallback">RM</span>
                    )}
                  </Link>
                ) : peer.roleModelImageUrl ? (
                  <img
                    className="role-avatar-inline"
                    src={peer.roleModelImageUrl}
                    alt={peer.roleModelName || "Role model"}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="role-avatar-inline avatar-fallback">RM</span>
                )}
              </div>
              <p className="peer-name">{peer.displayName}</p>
              {peer.roleModelId ? (
                <Link className="muted role-model-link" to={`/social/role-model/${peer.roleModelId}`}>
                  {peer.roleModelName || "No role model"}
                </Link>
              ) : (
                <p className="muted">{peer.roleModelName || "No role model"}</p>
              )}
            </div>
          ))}
          {peers.length === 0 ? <p className="muted">No peers yet.</p> : null}
        </div>
      </section>

      <section className="card social-card">
        <div className="card-header">
          <h3>Requests</h3>
        </div>
        <div className="requests">
          <div>
            <p className="eyebrow">Incoming</p>
            {incoming.map((req) => (
              <div key={req.id} className="request-row">
                <span>{req.requesterName}</span>
                <div className="request-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => handleRespond(req.id, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => handleRespond(req.id, "decline")}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
            {incoming.length === 0 ? (
              <p className="muted">No incoming requests.</p>
            ) : null}
          </div>
          <div>
            <p className="eyebrow">Outgoing</p>
            {outgoing.map((req) => (
              <div key={req.id} className="request-row">
                <span>{req.recipientName}</span>
                <span className="muted">Pending</span>
              </div>
            ))}
            {outgoing.length === 0 ? (
              <p className="muted">No outgoing requests.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
