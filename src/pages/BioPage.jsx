import { useEffect, useRef, useState } from "react";
import { getBio, regenerateBio, setRoleModel, updateRoleModel } from "../api.js";

export default function BioPage({ roleModel, onRoleModelChange }) {
  const [bio, setBio] = useState(roleModel?.bioText || "");
  const [notes, setNotes] = useState(roleModel?.notesText || "");
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [newName, setNewName] = useState("");
  const saveTimer = useRef(null);

  useEffect(() => {
    let isMounted = true;
    getBio()
      .then((data) => {
        if (!isMounted) return;
        setBio(data.bioText || "");
        setNotes(data.notesText || "");
      })
      .catch(() => null);
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!roleModel) return undefined;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    setSaving(true);
    saveTimer.current = setTimeout(() => {
      updateRoleModel({ notes })
        .then((data) => {
          setSaving(false);
          onRoleModelChange(data.roleModel);
        })
        .catch(() => {
          setSaving(false);
        });
    }, 900);

    return () => clearTimeout(saveTimer.current);
  }, [notes, roleModel, onRoleModelChange]);

  const handleRegenerate = async () => {
    setStatus(null);
    setRegenerating(true);
    try {
      const data = await regenerateBio();
      setBio(data.bioText || "");
      onRoleModelChange(data.roleModel);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleChangeRoleModel = async (event) => {
    event.preventDefault();
    setChanging(true);
    setStatus(null);

    try {
      const data = await setRoleModel({ name: newName });
      onRoleModelChange(data.roleModel);
      setBio(data.roleModel?.bioText || "");
      setNotes(data.roleModel?.notesText || "");
      setNewName("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="page bio-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Bio</p>
          <h2>{roleModel?.name || "Role model"}</h2>
        </div>
      </header>

      <section className="card bio-card">
        
        <div className="card-header">
          <h3>About the Role Model</h3>
          {regenerating ? (
            <p className="status pending">Generating a fresh bio</p>
          ) : null}
        </div>
        <div className="bio-text">
          {bio ? <p>{bio}</p> : <p className="muted">Generating...</p>}
        </div>
        <button
            className="secondary"
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
          >
            {regenerating ? "Generating..." : "Regenerate bio"}
          </button>
      </section>

      <section className="card notes-card">
        <div className="card-header">
          <h3>Personal Notes</h3>
        </div>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What are you tracking, learning, or mirroring?"
          rows={8}
        />
        <p className="status">{saving ? "Saving..." : "Saved"}</p>
      </section>

      <section className="card change-card">
        <div className="card-header">
          <h3>Change role model</h3>
          <p className="muted">
            Switch any time. You can only carry one, and they must be living with
            a significant online presence.
          </p>
        </div>
        <form onSubmit={handleChangeRoleModel} className="inline-form">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New role model"
            required
          />
          <button className="primary" type="submit" disabled={changing}>
            {changing ? "Switching..." : "Switch"}
          </button>
        </form>
        {status ? <p className="status error">{status}</p> : null}
      </section>
    </div>
  );
}
