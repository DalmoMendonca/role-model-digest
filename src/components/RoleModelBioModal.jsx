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
        console.log("getBio response:", bioData);
        if (!bioData) {
          setError("Failed to load bio information");
          return;
        }
        
        const bioText = bioData.bioText || "";
        console.log("Setting bio text:", bioText);
        setBio(bioText);
        
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

  console.log("Modal render state:", { loading, error, bio, roleModel });

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
        ) : bio ? (
          <div>
            <div className="card">
              <div className="card-header">
                <h4>Bio</h4>
              </div>
              
              <div className="bio-text">
                <p>{bio}</p>
              </div>
              
              {/* Debug info */}
              <div style={{ marginTop: "20px", padding: "10px", background: "#f0f0f0", fontSize: "12px" }}>
                <strong>Debug:</strong> bio length = {bio ? bio.length : 0}, roleModel = {roleModel ? 'exists' : 'null'}
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
