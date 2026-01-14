import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSocialRoleModel } from "../api.js";

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

export default function SocialRoleModelPage() {
  const { id } = useParams();
  const [roleModel, setRoleModel] = useState(null);
  const [bio, setBio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadRoleModel = async () => {
      if (!id) {
        setError("Role model ID is required");
        setLoading(false);
        return;
      }

      try {
        console.log("Loading role model with ID:", id);
        const data = await getSocialRoleModel(id);
        console.log("Role model data received:", data);
        setRoleModel(data.roleModel);
        setBio(data.bio);
      } catch (err) {
        console.error("Failed to load role model:", err);
        setError(err.message || "Failed to load role model");
      } finally {
        setLoading(false);
      }
    };

    loadRoleModel();
  }, [id]);

  if (loading) {
    return (
      <div className="page">
        <div className="loading-screen">
          <div className="spinner" />
          <p>Loading role model...</p>
        </div>
      </div>
    );
  }

  if (error || !roleModel) {
    return (
      <div className="page">
        <div className="card">
          <h2>Role Model Not Found</h2>
          <p className="muted">{error || "This role model could not be found."}</p>
          <Link to="/social" className="primary">
            Back to Social
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="role-model-hero">
        {roleModel.imageUrl && (
          <img 
            src={roleModel.imageUrl} 
            alt={`${roleModel.name} portrait`}
            referrerPolicy="no-referrer"
          />
        )}
        <div className="role-model-hero-info">
          <h2>{roleModel.name}</h2>
          <p>Role model since {formatDateTime(roleModel.createdAt)}</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Bio</h3>
        </div>
        
        {bio ? (
          <div className="bio-text">
            <p>{bio.bioText}</p>
            {bio.personalNotes && (
              <div style={{ marginTop: "16px" }}>
                <h4>Personal Notes</h4>
                <p style={{ fontStyle: "italic", color: "var(--muted)" }}>
                  {bio.personalNotes}
                </p>
              </div>
            )}
            <p className="muted" style={{ marginTop: "12px", fontSize: "0.8rem" }}>
              Last updated {formatDateTime(bio.updatedAt || bio.createdAt)}
            </p>
          </div>
        ) : (
          <p className="muted">No bio available for this role model.</p>
        )}

        <div style={{ marginTop: "24px" }}>
          <Link to="/social" className="secondary">
            ← Back to Social
          </Link>
        </div>
      </div>
    </div>
  );
}
