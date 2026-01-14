import { useState, useEffect } from "react";
import { getSocialRoleModel } from "../api.js";

export default function RoleModelBioModal({ roleModelId, isOpen, onClose }) {
  const [roleModel, setRoleModel] = useState(null);
  const [bio, setBio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !roleModelId) return;

    console.log("Modal opening with roleModelId:", roleModelId);

    const loadBio = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Use the correct API call for getting a specific role model's bio
        console.log("Loading role model with ID:", roleModelId);
        const data = await getSocialRoleModel(roleModelId);
        console.log("Role model data received:", data);
        
        if (!data) {
          setError("Failed to load bio information");
          return;
        }
        
        console.log("Setting roleModel:", data.roleModel);
        console.log("Setting bio:", data.bio);
        
        setRoleModel(data.roleModel);
        setBio(data.bio);
      } catch (err) {
        console.error("Failed to load bio:", err);
        setError("Failed to load bio information");
      } finally {
        setLoading(false);
      }
    };

    loadBio();
  }, [isOpen, roleModelId]);

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

  if (!isOpen) return null;

  console.log("Modal render state:", { loading, error, bio, roleModel });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-info">
            {roleModel?.imageUrl ? (
              <img 
                src={roleModel.imageUrl} 
                alt={`${roleModel.name} portrait`}
                className="modal-header-avatar"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="modal-header-avatar">
                {roleModel?.name?.charAt(0) || "R"}
              </div>
            )}
            <h3 className="modal-header-name">{roleModel?.name || "Role Model"}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        {loading ? (
          <div className="loading-screen">
            <div className="spinner" />
            <p>Loading bio...</p>
          </div>
        ) : error ? (
          <div className="card">
            <p className="muted">{error}</p>
          </div>
        ) : bio ? (
          <div>
            <div className="card">
              <div className="bio-text">
                <p>{bio?.bioText || bio || "No bio text available"}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <p className="muted">No bio available for this role model.</p>
          </div>
        )}
      </div>
    </div>
  );
}
