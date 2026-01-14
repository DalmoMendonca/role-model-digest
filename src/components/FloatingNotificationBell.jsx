import { useEffect, useRef, useState } from "react";
import { getUnreadNotificationCount } from "../api.js";
import { auth, onAuthChange } from "../firebase.js";

export default function FloatingNotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const pollRef = useRef(null);

  const loadUnreadCount = async () => {
    try {
      if (!auth.currentUser) {
        setUnreadCount(0);
        return;
      }
      const count = await getUnreadNotificationCount();
      setUnreadCount(count?.unreadCount || 0);
    } catch (error) {
      console.error("Failed to load unread count:", error);
    }
  };

  useEffect(() => {
    const startPolling = () => {
      if (pollRef.current) return;
      loadUnreadCount();
      pollRef.current = setInterval(loadUnreadCount, 25000);
    };

    const stopPolling = () => {
      if (!pollRef.current) return;
      clearInterval(pollRef.current);
      pollRef.current = null;
    };

    const unsubscribe = onAuthChange((user) => {
      if (user) {
        startPolling();
      } else {
        stopPolling();
        setUnreadCount(0);
      }
    });

    if (auth.currentUser) {
      startPolling();
    }

    return () => {
      stopPolling();
      unsubscribe();
    };
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
