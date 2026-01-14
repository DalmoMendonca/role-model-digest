import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  updatePreferences
} from "../api.js";

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

function getNotificationLabel(notification) {
  const type = notification?.type || "";
  if (type === "new_digest") return "New digest";
  if (type === "reaction") return "Reaction";
  if (type === "comment") return "Comment";
  if (type === "reply") return "Reply";
  return "Update";
}

export default function NotificationsPage({ user, onUserUpdate }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const data = await getNotifications(40);
    setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
    if (typeof data.unreadCount === "number") {
      setUnreadCount(data.unreadCount);
      return;
    }
    const count = await getUnreadNotificationCount();
    setUnreadCount(count?.unreadCount || 0);
  };

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    load()
      .catch(() => null)
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const sortedNotifications = useMemo(() => {
    const list = Array.isArray(notifications) ? notifications.slice() : [];
    list.sort((a, b) => `${b.createdAt || ""}`.localeCompare(`${a.createdAt || ""}`));
    return list;
  }, [notifications]);

  const handleToggleZenMode = async () => {
    const nextValue = !user?.zenMode;
    setSaving(true);
    setStatus(null);
    try {
      const data = await updatePreferences({
        weeklyEmailOptIn: !!user?.weeklyEmailOptIn,
        timezone: user?.timezone,
        zenMode: nextValue
      });
      if (data?.user && onUserUpdate) {
        onUserUpdate(data.user);
      }
      setStatus(nextValue ? "Zen mode enabled." : "Zen mode disabled.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkAllRead = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await markAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkRead = async (id) => {
    if (!id) return;
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <div className="page notifications-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Notifications</p>
          <h2>Inbox</h2>
        </div>
        <div className="header-actions">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={!!user?.zenMode}
              onChange={handleToggleZenMode}
              disabled={saving}
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
            <span className="toggle-state">{user?.zenMode ? "On" : "Off"}</span>
            <span className="toggle-label">Zen mode</span>
          </label>
          <button className="secondary" type="button" onClick={handleMarkAllRead} disabled={saving}>
            Mark all read
          </button>
        </div>
      </header>

      {status ? <p className="status">{status}</p> : null}
      {loading ? <p className="muted">Loading notifications...</p> : null}

      <section className="card notifications-card">
        <div className="card-header">
          <h3>
            Updates {unreadCount ? <span className="pill">{unreadCount} unread</span> : null}
          </h3>
          <p className="muted">Reactions, comments, and new digests from your peers.</p>
        </div>

        {sortedNotifications.length ? (
          <div className="notifications-list">
            {sortedNotifications.map((notification) => {
              const label = getNotificationLabel(notification);
              const isUnread = !notification.readAt;
              const message = notification.message || "";
              return (
                <div
                  key={notification.id}
                  className={`notification-row ${isUnread ? "unread" : ""}`}
                >
                  <div className="notification-meta">
                    <p className="notification-title">
                      {label}{" "}
                      {isUnread ? <span className="dot" aria-hidden="true" /> : null}
                    </p>
                    <p className="notification-time">
                      {formatDateTime(notification.createdAt)}
                    </p>
                    <p className="notification-message">{message}</p>
                    {notification.digestId ? (
                      <Link
                        className="notification-link"
                        to="/social"
                        onClick={() => handleMarkRead(notification.id)}
                      >
                        View in Social
                      </Link>
                    ) : null}
                  </div>
                  {isUnread ? (
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => handleMarkRead(notification.id)}
                    >
                      Mark read
                    </button>
                  ) : (
                    <span className="muted">Read</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">No notifications yet.</p>
        )}
      </section>
    </div>
  );
}
