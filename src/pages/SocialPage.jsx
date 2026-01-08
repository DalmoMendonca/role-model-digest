import { useEffect, useState } from "react";
import { getPeers, getTimeline, respondToRequest, sendPeerRequest } from "../api.js";

export default function SocialPage() {
  const [peers, setPeers] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [email, setEmail] = useState("");
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState(null);

  const loadSocial = async () => {
    const peerData = await getPeers();
    setPeers(peerData.peers || []);
    setIncoming(peerData.incomingRequests || []);
    setOutgoing(peerData.outgoingRequests || []);
    const timelineData = await getTimeline("");
    setTimeline(timelineData.entries || []);
  };

  useEffect(() => {
    loadSocial().catch(() => null);
  }, []);

  const handleRequest = async (event) => {
    event.preventDefault();
    setStatus(null);
    try {
      await sendPeerRequest({ email });
      setEmail("");
      setStatus("Request sent.");
      loadSocial();
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleRespond = async (id, action) => {
    setStatus(null);
    try {
      await respondToRequest(id, action);
      loadSocial();
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleFilter = async (value) => {
    setFilter(value);
    const data = await getTimeline(value);
    setTimeline(data.entries || []);
  };

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
            placeholder="Add peer by email"
            required
          />
          <button className="primary" type="submit">
            Send request
          </button>
        </form>
      </header>

      {status ? <p className="status">{status}</p> : null}

      <section className="card timeline-card">
        <div className="card-header">
          <h3>Timeline</h3>
          <p className="muted">Filter by peer, role model, or topic.</p>
        </div>
        <input
          className="filter-input"
          type="text"
          value={filter}
          onChange={(event) => handleFilter(event.target.value)}
          placeholder="Filter the timeline"
        />
        <div className="timeline">
          {timeline.map((entry) => (
            <article key={entry.id} className="timeline-card">
              <div className="timeline-header">
                <p className="peer-name">{entry.peerName}</p>
                <p className="muted">{entry.roleModelName}</p>
              </div>
              <p className="timeline-bio">{entry.bioText}</p>
              <div className="timeline-digest">
                <p className="eyebrow">Latest digest</p>
                <p>{entry.latestDigestSummary || "No digest yet."}</p>
              </div>
            </article>
          ))}
          {timeline.length === 0 ? (
            <p className="muted">No peer activity yet.</p>
          ) : null}
        </div>
      </section>

      <section className="card peers-card requests-card">
        <div className="card-header">
          <h3>Your Peers</h3>
        </div>
        <div className="peer-grid">
          {peers.map((peer) => (
            <div key={peer.id} className="peer-chip">
              <p className="peer-name">{peer.displayName}</p>
              <p className="muted">{peer.roleModelName || "No role model"}</p>
            </div>
          ))}
          {peers.length === 0 ? <p className="muted">No peers yet.</p> : null}
        </div>
        <p className="eyebrow"><span> </span></p>
        <div className="card-header p-6">
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
