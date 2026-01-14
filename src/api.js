import { auth, signOutUser } from "./firebase.js";

const API_BASE = import.meta.env.VITE_API_URL || "https://us-central1-role-model-digest-2026.cloudfunctions.net";
const API_BASE_NORMALIZED = API_BASE.replace(/\/+$/, "");

const normalizePath = (path) => (path.startsWith("/") ? path : `/${path}`);

function buildApiUrls(path) {
  const normalizedPath = normalizePath(path);
  const primaryUrl = `${API_BASE_NORMALIZED}${normalizedPath}`;
  let fallbackUrl = null;

  // Avoid a double "/api" when the base already includes "/api".
  if (API_BASE_NORMALIZED.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    fallbackUrl = `${API_BASE_NORMALIZED}${normalizedPath.slice(4)}`;
  }

  return { primaryUrl, fallbackUrl };
}

async function requestOnce(url, options) {
  const response = await fetch(url, options);

  if (response.status === 204) {
    return { response, data: null };
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  return { response, data };
}

export async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const { primaryUrl, fallbackUrl } = buildApiUrls(path);
  const requestOptions = {
    headers,
    ...options
  };

  const { response, data } = await requestOnce(primaryUrl, requestOptions);

  if (response.status === 404 && data === null && fallbackUrl) {
    const retry = await requestOnce(fallbackUrl, requestOptions);
    if (!retry.response.ok) {
      const message = retry.data?.error || "Request failed";
      throw new Error(message);
    }
    return retry.data;
  }

  if (!response.ok) {
    const message = data?.error || "Request failed";
    throw new Error(message);
  }

  return data;
}

export function getMe() {
  return apiRequest("/api/me");
}

export function logout() {
  return signOutUser();
}

export function setRoleModel(payload) {
  return apiRequest("/api/role-model", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateRoleModel(payload) {
  return apiRequest("/api/role-model", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function regenerateBio() {
  return apiRequest("/api/role-model/bio", {
    method: "POST"
  });
}

export function getBio() {
  return apiRequest("/api/bio");
}

export function getRoleModelImage(options = {}) {
  const query = options.refresh ? "?refresh=1" : "";
  return apiRequest(`/api/role-model/image${query}`);
}

export function getDigests() {
  return apiRequest("/api/digests");
}

export function getPublicDigest(digestId) {
  return apiRequest(`/api/digests/share/${digestId}`);
}

export function runDigest() {
  return apiRequest("/api/digests/run", {
    method: "POST"
  });
}

export function updatePreferences(payload) {
  return apiRequest("/api/preferences", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function getPeers() {
  return apiRequest("/api/social/peers");
}

export function getRoleModel() {
  return apiRequest("/api/role-model");
}

export function sendPeerRequest(payload) {
  return apiRequest("/api/social/requests", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function respondToRequest(requestId, action) {
  return apiRequest(`/api/social/requests/${requestId}/${action}`,
    {
      method: "POST"
    }
  );
}

export function getTimeline(query) {
  const queryString = query ? `?q=${encodeURIComponent(query)}` : "";
  return apiRequest(`/api/social/timeline${queryString}`);
}

export function getSocialUsers(query) {
  const queryString = query ? `?q=${encodeURIComponent(query)}` : "";
  return apiRequest(`/api/social/users${queryString}`);
}

export function getAdminOverview() {
  return apiRequest("/api/admin/overview");
}

export function adminRespondPeerRequest(requestId, action) {
  return apiRequest(`/api/admin/requests/${requestId}/${action}`, {
    method: "POST"
  });
}

export function addDigestReaction(digestId, type) {
  return apiRequest(`/api/social/digests/${digestId}/reactions`, {
    method: "POST",
    body: JSON.stringify({ type })
  });
}

export function addDigestComment(digestId, payload) {
  return apiRequest(`/api/social/digests/${digestId}/comments`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getDigestThread(digestId) {
  return apiRequest(`/api/social/digests/${digestId}/thread`);
}

export function getNotifications(limit) {
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  return apiRequest(`/api/notifications${query}`);
}

export function getUnreadNotificationCount() {
  return apiRequest("/api/notifications/unread-count");
}

export function markAllNotificationsRead() {
  return apiRequest("/api/notifications/read-all", { method: "POST" });
}

export function markNotificationRead(notificationId) {
  return apiRequest(`/api/notifications/${notificationId}/read`, { method: "POST" });
}

export function getSocialRoleModel(roleModelId) {
  return apiRequest(`/api/social/role-models/${roleModelId}`);
}
