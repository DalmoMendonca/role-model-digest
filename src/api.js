import { auth, signOutUser } from "./firebase.js";

const API_BASE = import.meta.env.VITE_API_URL || "";

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

export function getAdminOverview() {
  return apiRequest("/api/admin/overview");
}
