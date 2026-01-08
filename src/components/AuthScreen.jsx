import { useEffect, useState } from "react";

export default function AuthScreen({ onAuth }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "google" && params.get("status") === "error") {
      setStatus("Google sign-in failed. Please try again.");
    }
    if (params.get("auth") === "google") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleGoogleLogin = () => {
    setLoading(true);
    window.location.href = "/api/auth/google";
  };

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <div className="auth-header">
          <p className="eyebrow">Role Model Digest</p>
          <h1>Keep tabs on your living inspiration.</h1>
          <p className="muted">
            Pick a role model to get short, weekly reports on their activity. Share
            updates with your friends.
          </p>
        </div>
        <div className="auth-form">
          <button
            type="button"
            className="google-button"
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M16.51 9H9v2.89h4.13c-.2 1.37-1.59 3.99-4.13 3.99-2.48 0-4.51-2.06-4.51-4.59s2.03-4.59 4.51-4.59c1.29 0 2.35.54 3.13 1.39l2.29-2.21C13.46 2.89 11.43 2 9 2 5.48 2 2.5 4.92 2.5 8.29s2.98 6.29 6.5 6.29c3.75 0 6.51-2.67 6.51-6.23 0-.42-.05-.82-.15-1.35z"/>
              <path fill="#34A853" d="M3.53 7.47L5.79 5.69C6.57 4.84 7.63 4.3 8.92 4.3c2.54 0 3.93 2.62 4.13 3.99H9V9h7.51c.1.53.15.93.15 1.35 0 3.56-2.76 6.23-6.51 6.23-3.02 0-5.58-1.88-6.62-4.53z"/>
              <path fill="#FBBC05" d="M16.51 9c0-.42-.05-.82-.15-1.35H9v2.89h4.13c-.2 1.37-1.59 3.99-4.13 3.99v2.67c3.75 0 6.51-2.67 6.51-6.23z"/>
              <path fill="#EA4335" d="M9 16.58c-2.48 0-4.51-2.06-4.51-4.59s2.03-4.59 4.51-4.59c1.29 0 2.35.54 3.13 1.39l2.29-2.21C13.46 2.89 11.43 2 9 2 5.48 2 2.5 4.92 2.5 8.29s2.98 6.29 6.5 6.29v-2.67z"/>
            </svg>
            Continue with Google
          </button>
          {status ? <p className="status error">{status}</p> : null}
        </div>
      </div>
      <div className="auth-visual">
        <div className="orb" />
        <div className="orb small" />
        <div className="stripe" />
        <div className="stripe thin" />
        <div className="dictionary-entry">
          <p className="dictionary-term">role model</p>
          <p className="dictionary-pos">noun</p>
          <p className="dictionary-def">
            a person whom you admire and whose behavior and example you try to emulate
          </p>
        </div>
      </div>
    </div>
  );
}
