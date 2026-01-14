import { useState, useEffect } from "react";

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
        // Use a direct Firestore approach instead of API
        const { doc, getDoc, collection, query, where, orderBy, limit, getDocs } = await import("firebase/firestore");
        const { db } = await import("../firebase.js");
        
        // Get role model data
        const roleModelDoc = await doc(db, "roleModels", roleModelId).get();
        if (!roleModelDoc.exists()) {
          setError("Role model not found");
          return;
        }
        
        const roleModelData = { id: roleModelDoc.id, ...roleModelDoc.data() };
        setRoleModel(roleModelData);
        
        // Get bio data
        const bioQuery = query(
          collection(db, "bios"),
          where("roleModelId", "==", roleModelId),
          orderBy("createdAt", "desc"),
          limit(1)
        );
        
        const bioSnapshot = await getDocs(bioQuery);
        if (!bioSnapshot.empty) {
          const bioData = { id: bioSnapshot.docs[0].id, ...bioSnapshot.docs[0].data() };
          setBio(bioData);
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
                  <p>{bio.bioText}</p>
                  {bio.personalNotes && (
                    <div style={{ marginTop: "16px" }}>
                      <h5>Personal Notes</h5>
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
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
