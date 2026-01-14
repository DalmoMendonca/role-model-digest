import { useEffect, useState } from "react";
import { getUnreadNotificationCount } from "../api.js";

export default function FloatingNotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="floating-notification-bell">
      <button
        className="bell-button"
        aria-label="Notifications"
        onClick={() => window.location.href = '/notifications'}
      >
        <i className="fa fa-bell" />
        {unreadCount > 0 && (
          <span className="bell-badge">{unreadCount}</span>
        )}
      </button>
    </div>
  );
}
