import { useState } from "react";
import { setRoleModel } from "../api.js";

export default function RoleModelSetup({ onComplete }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus(null);
    setLoading(true);

    try {
      const data = await setRoleModel({ name });
      onComplete(data);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <p className="eyebrow">Choose one</p>
        <h2>Pick your role model</h2>
        <p className="muted">
          Choose a living person with a significant online presence. You can change
          this anytime, but you only have one role model at a time.
        </p>
        <form onSubmit={handleSubmit} className="setup-form">
          <label>
            Role model name
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Oprah Winfrey, Tim Ferriss, Satya Nadella..."
              required
            />
          </label>
          {status ? <p className="status error">{status}</p> : null}
          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Setting..." : "Set role model"}
          </button>
        </form>
      </div>
    </div>
  );
}
