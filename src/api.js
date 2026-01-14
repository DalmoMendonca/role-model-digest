import { auth, signOutUser } from "./firebase.js";

const API_BASE = import.meta.env.VITE_API_URL || "https://us-central1-role-model-digest-2026.cloudfunctions.net";
console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);
console.log('API_BASE:', API_BASE);

export async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || "Request failed";
    throw new Error(message);
  }

  return data;
}

export function getMe() {
  return apiRequest("/me");
}

export function logout() {
  return signOutUser();
}

export function setRoleModel(payload) {
  return apiRequest("/role-model", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateRoleModel(payload) {
  return apiRequest("/role-model", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function regenerateBio() {
  return apiRequest("/role-model/bio", {
    method: "POST"
  });
}

export function getBio() {
  return apiRequest("/bio");
}

export function getRoleModelImage(options = {}) {
  const query = options.refresh ? "?refresh=1" : "";
  return apiRequest(`/role-model/image${query}`);
}

export function getDigests() {
  return apiRequest("/digests");
}

export function getPublicDigest(digestId) {
  return apiRequest(`/digests/share/${digestId}`);
}

export function runDigest() {
  return apiRequest("/digests/run", {
    method: "POST"
  });
}

export function updatePreferences(payload) {
  return apiRequest("/preferences", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function getPeers() {
  return apiRequest("/social/peers");
}

export function getRoleModel() {
  return apiRequest("/role-model");
}

export function sendPeerRequest(payload) {
  return apiRequest("/social/requests", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function respondToRequest(requestId, action) {
  return apiRequest(`/social/requests/${requestId}/${action}`,
    {
      method: "POST"
    }
  );
}

export function getTimeline(query) {
  const queryString = query ? `?q=${encodeURIComponent(query)}` : "";
  return apiRequest(`/social/timeline${queryString}`);
}

export function getSocialUsers(query) {
  const queryString = query ? `?q=${encodeURIComponent(query)}` : "";
  return apiRequest(`/social/users${queryString}`);
}

export function getAdminOverview() {
  return apiRequest("/admin/overview");
}

export function adminRespondPeerRequest(requestId, action) {
  return apiRequest(`/admin/requests/${requestId}/${action}`, {
    method: "POST"
  });
}

export function addDigestReaction(digestId, type) {
  return apiRequest(`/social/digests/${digestId}/reactions`, {
    method: "POST",
    body: JSON.stringify({ type })
  });
}

export function addDigestComment(digestId, payload) {
  return apiRequest(`/social/digests/${digestId}/comments`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getDigestThread(digestId) {
  return apiRequest(`/social/digests/${digestId}/thread`);
}

export function getNotifications(limit) {
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  return apiRequest(`/notifications${query}`);
}

export function getUnreadNotificationCount() {
  return apiRequest("/notifications/unread-count");
}

export function markAllNotificationsRead() {
  return apiRequest("/notifications/read-all", { method: "POST" });
}

export function markNotificationRead(notificationId) {
  return apiRequest(`/notifications/${notificationId}/read`, { method: "POST" });
}

export function getSocialRoleModel(roleModelId) {
  return apiRequest(`/social/role-models/${roleModelId}`);
}
