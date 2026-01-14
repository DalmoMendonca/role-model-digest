import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { getUnreadNotificationCount } from "../api.js";
import NotificationsDropdown from "./NotificationsDropdown.jsx";

export default function Nav({ user, roleModel, onLogout, onImageRefresh, onUserUpdate, isAdmin }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    setImageFailed(false);
  }, [roleModel?.id, roleModel?.imageUrl]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const data = await getUnreadNotificationCount();
        if (!isMounted) return;
        setUnreadCount(data?.unreadCount || 0);
      } catch (error) {
        if (!isMounted) return;
        setUnreadCount(0);
      }
    };

    load();
    const interval = setInterval(load, 25000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <nav className="nav">
      <div className="brand">
        <div className="brand-mark">📚</div>
        <div>
          <h1>Role Model Digest</h1>
          <p className="brand-tagline">Weekly wisdom from your heroes</p>
        </div>
      </div>

      <div className="nav-links">
        <NavLink to="/bio" end>
          <i className="fa fa-user-edit" />
          <span className="nav-label">Bio</span>
        </NavLink>
        <NavLink to="/digest">
          <i className="fa fa-newspaper" />
          <span className="nav-label">Digest</span>
        </NavLink>
        <NavLink to="/social">
          <i className="fa fa-users" />
          <span className="nav-label">Social</span>
        </NavLink>
        <NotificationsDropdown user={user} onUserUpdate={onUserUpdate} />
        {isAdmin ? (
          <NavLink to="/admin">
            <i className="fa fa-cog" />
            <span className="nav-label">Admin</span>
          </NavLink>
        ) : null}
      </div>

      <div className="nav-profile">
        <div className="user-info">
          {roleModel?.imageUrl && !imageFailed ? (
            <img
              className="user-avatar"
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
          <span className="user-name">{roleModel?.name || "No role model"}</span>
        </div>
        <button className="logout-button" onClick={onLogout}>
          <i className="fa fa-sign-out-alt" />
        </button>
      </div>
    </nav>
  );
}
