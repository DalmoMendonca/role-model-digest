import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { getMe, getRoleModelImage, logout } from "./api.js";
import { onAuthChange } from "./firebase.js";
import AuthScreen from "./components/AuthScreen.jsx";
import Nav from "./components/Nav.jsx";
import RoleModelSetup from "./components/RoleModelSetup.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import BioPage from "./pages/BioPage.jsx";
import DigestPage from "./pages/DigestPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import PublicDigestPage from "./pages/PublicDigestPage.jsx";
import SocialPage from "./pages/SocialPage.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [roleModel, setRoleModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshAttemptRef = useRef(new Set());
  const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || "dalmomendonca@gmail.com").toLowerCase();
  const isAdmin = !!user?.email && user.email.toLowerCase() === adminEmail;

  const isLowQualityImage = (url = "") => {
    const lowerUrl = url.toLowerCase();
    const blockedDomains = [
      "amazon.com",
      "m.media-amazon.com",
      "images-na.ssl-images-amazon.com",
      "goodreads.com",
      "books.google.com",
      "barnesandnoble.com",
      "audible.com"
    ];
    return blockedDomains.some((domain) => lowerUrl.includes(domain));
  };

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = onAuthChange(async (firebaseUser) => {
      if (!isMounted) return;
      if (!firebaseUser) {
        setUser(null);
        setRoleModel(null);
        setLoading(false);
        return;
      }
      try {
        const data = await getMe();
        if (!isMounted) return;
        setUser(data.user || null);
        setRoleModel(data.roleModel || null);
      } catch (error) {
        if (!isMounted) return;
        setUser({
          id: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || firebaseUser.email || "User",
          weeklyEmailOptIn: true
        });
        setRoleModel(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!roleModel) return;
    const shouldRefresh = !roleModel.imageUrl || isLowQualityImage(roleModel.imageUrl);
    if (!shouldRefresh) return;
    const refreshKey = `${roleModel.id || "role"}:${roleModel.imageUrl || ""}`;
    if (refreshAttemptRef.current.has(refreshKey)) return;
    refreshAttemptRef.current.add(refreshKey);
    let isMounted = true;
    getRoleModelImage({ refresh: !!roleModel.imageUrl })
      .then((data) => {
        if (!isMounted || !data?.imageUrl) return;
        setRoleModel((prev) => (prev ? { ...prev, imageUrl: data.imageUrl } : prev));
      })
      .catch(() => null);
    return () => {
      isMounted = false;
    };
  }, [roleModel]);

  const handleImageRefresh = async () => {
    if (!roleModel) return;
    const refreshKey = `${roleModel.id || "role"}:${roleModel.imageUrl || ""}`;
    if (refreshAttemptRef.current.has(refreshKey)) return;
    refreshAttemptRef.current.add(refreshKey);
    try {
      const data = await getRoleModelImage({ refresh: true });
      if (data?.imageUrl) {
        setRoleModel((prev) => (prev ? { ...prev, imageUrl: data.imageUrl } : prev));
      }
    } catch (error) {
      // Best-effort refresh only.
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setRoleModel(null);
  };

  const protectedContent = (() => {
    if (loading) {
      return (
        <div className="loading-screen">
          <div className="spinner" />
          <p>Thinking...</p>
        </div>
      );
    }

  if (!user) {
    return <AuthScreen />;
  }

  if (!roleModel) {
    return (
      <RoleModelSetup
        onComplete={(data) => {
          setUser(data.user || user);
          setRoleModel(data.roleModel || null);
        }}
      />
    );
  }

    return (
      <div className="app-shell">
        <Nav
          user={user}
          roleModel={roleModel}
          onLogout={handleLogout}
          onImageRefresh={handleImageRefresh}
          isAdmin={isAdmin}
        />
        <main className="stage">
          <Routes>
            <Route
              path="/bio"
              element={
                <BioPage
                  roleModel={roleModel}
                  onRoleModelChange={setRoleModel}
                />
              }
            />
            <Route
              path="/digest"
              element={
                <DigestPage
                  user={user}
                  roleModel={roleModel}
                  onUserUpdate={setUser}
                />
              }
            />
            <Route path="/social" element={<SocialPage />} />
            <Route
              path="/admin"
              element={isAdmin ? <AdminPage /> : <Navigate to="/bio" replace />}
            />
            <Route path="/" element={<Navigate to="/bio" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
    );
  })();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/digest/share/:digestId" element={<PublicDigestPage />} />
        <Route path="/*" element={protectedContent} />
      </Routes>
    </BrowserRouter>
  );
}
