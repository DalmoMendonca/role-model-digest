import { useState } from "react";
import { getRoleModel } from "../api.js";

export default function RoleModelSetup({ onComplete }) {
  const [roleModel, setRoleModel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const roleModelData = {
      name: formData.get("name"),
      imageUrl: formData.get("imageUrl")
    };

    setLoading(true);
    setStatus(null);
    try {
      const response = await getRoleModel();
      setRoleModel(response);
      onComplete({ roleModel: response, user: response.user });
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Role Model</p>
          <h2>Choose Your Role Model</h2>
        </div>
      </header>

      {status && <p className="status">{status}</p>}
      {loading ? (
        <p className="muted">Loading role models...</p>
      ) : roleModel ? (
        <div className="card">
          <div className="card-header">
            <h3>{roleModel.name}</h3>
            <p className="muted">
              Added {roleModel.createdAt ? new Date(roleModel.createdAt).toLocaleDateString() : ""}
            </p>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>
                Role Model Name
                <input
                  type="text"
                  name="name"
                  defaultValue={roleModel.name}
                  required
                />
              </label>
            </div>
            <div className="form-group">
              <label>
                Role Model Image URL
                <input
                  type="url"
                  name="imageUrl"
                  defaultValue={roleModel.imageUrl}
                  required
                />
              </label>
            </div>
            <button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Role Model"}
            </button>
          </form>
        </div>
      ) : (
        <p className="muted">No role models available.</p>
      )}
    </div>
  );
}
