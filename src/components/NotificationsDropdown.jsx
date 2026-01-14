import { useEffect, useState, useRef } from "react";
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

export default function NotificationsDropdown({ user, onUserUpdate }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef(null);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const data = await getNotifications(10);
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      if (typeof data.unreadCount === "number") {
        setUnreadCount(data.unreadCount);
      }
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    try {
      const count = await getUnreadNotificationCount();
      setUnreadCount(count?.unreadCount || 0);
    } catch (error) {
      console.error("Failed to load unread count:", error);
    }
  };

  useEffect(() => {
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 25000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadNotifications();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggleZenMode = async () => {
    const nextValue = !user?.zenMode;
    setSaving(true);
    try {
      const data = await updatePreferences({
        weeklyEmailOptIn: !!user?.weeklyEmailOptIn,
        timezone: user?.timezone,
        zenMode: nextValue
      });
      if (data?.user && onUserUpdate) {
        onUserUpdate(data.user);
      }
    } catch (error) {
      console.error("Failed to update zen mode:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkAllRead = async () => {
    setSaving(true);
    try {
      await markAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error("Failed to mark all read:", error);
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
      console.error("Failed to mark read:", error);
    }
  };

  const sortedNotifications = [...notifications].sort((a, b) => 
    `${b.createdAt || ""}`.localeCompare(`${a.createdAt || ""}`)
  );

  return (
    <div className="notifications-dropdown" ref={dropdownRef}>
      <button
        className="notifications-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notifications"
      >
        <i className="fa fa-bell" />
        {unreadCount > 0 && (
          <span className="notifications-badge">{unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="notifications-panel">
          <div className="notifications-header">
            <h3>Notifications</h3>
            <div className="notifications-actions">
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
                <span className="toggle-label">Zen</span>
              </label>
              {unreadCount > 0 && (
                <button
                  className="ghost"
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={saving}
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="notifications-content">
            {loading ? (
              <p className="muted">Loading...</p>
            ) : sortedNotifications.length ? (
              sortedNotifications.map((notification) => {
                const label = getNotificationLabel(notification);
                const isUnread = !notification.readAt;
                const message = notification.message || "";
                return (
                  <div
                    key={notification.id}
                    className={`notification-item ${isUnread ? "unread" : ""}`}
                  >
                    <div className="notification-content">
                      <p className="notification-title">
                        {label}
                        {isUnread && <span className="notification-dot" />}
                      </p>
                      <p className="notification-time">
                        {formatDateTime(notification.createdAt)}
                      </p>
                      <p className="notification-message">{message}</p>
                      {notification.digestId ? (
                        <Link
                          className="notification-link"
                          to="/social"
                          onClick={() => {
                            handleMarkRead(notification.id);
                            setIsOpen(false);
                          }}
                        >
                          View in Social
                        </Link>
                      ) : null}
                    </div>
                    {isUnread && (
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => handleMarkRead(notification.id)}
                      >
                        <i className="fa fa-check" />
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="muted">No notifications yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
