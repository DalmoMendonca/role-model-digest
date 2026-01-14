import { useState, useEffect } from "react";
import { getBio } from "../api.js";

export default function RoleModelBioModal({ roleModelId, isOpen, onClose }) {
  const [roleModel, setRoleModel] = useState(null);
  const [bio, setBio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !roleModelId) return;

    const loadBio = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Use API call instead of direct Firestore approach
        const bioData = await getBio(roleModelId);
        if (!bioData) {
          setError("Failed to load bio information");
          return;
        }
        
        setBio(bioData.bioText || "");
        
        // Get role model data from bio response
        if (bioData.roleModel) {
          setRoleModel(bioData.roleModel);
        }
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Role Model Bio</h2>
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
        ) : roleModel ? (
          <div>
            <div className="role-model-hero">
              {roleModel.imageUrl && (
                <img 
                  src={roleModel.imageUrl} 
                  alt={`${roleModel.name} portrait`}
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="role-model-hero-info">
                <h3>{roleModel.name}</h3>
                <p>Role model since {formatDateTime(roleModel.createdAt)}</p>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h4>Bio</h4>
              </div>
              
              {bio ? (
                <div className="bio-text">
                  <p>{bio}</p>
                </div>
              ) : (
                <p className="muted">No bio available for this role model.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
