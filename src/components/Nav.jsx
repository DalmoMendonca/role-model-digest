import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

export default function Nav({ user, roleModel, onLogout, onImageRefresh, isAdmin }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [roleModel?.id, roleModel?.imageUrl]);

  return (
    <aside className="nav">
      <div className="brand">
        <span className="brand-mark avatar">
          {roleModel?.imageUrl && !imageFailed ? (
            <img
              src={roleModel.imageUrl}
              alt={`${roleModel.name} portrait`}
              referrerPolicy="no-referrer"
              onError={() => {
                setImageFailed(true);
                if (onImageRefresh) {
                  onImageRefresh();
                }
              }}
            />
          ) : (
            "RM"
          )}
        </span>
        <div>
          <p className="eyebrow">Role Model Digest</p>
          <p className="brand-sub">{roleModel?.name || "No role model"}</p>
        </div>
      </div>
      <nav className="nav-links">
        <NavLink to="/bio" className={({ isActive }) => (isActive ? "active" : "")}
        >
          Bio
        </NavLink>
        <NavLink
          to="/digest"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          Digest
        </NavLink>
        <NavLink
          to="/social"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          Social
        </NavLink>
        {isAdmin ? (
          <NavLink
            to="/admin"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Admin
          </NavLink>
        ) : null}
      </nav>
      <div className="nav-footer">
        <p className="muted">{user.displayName}</p>
        <button className="ghost" type="button" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
