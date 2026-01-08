import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="auth-screen notfound-screen">
      <div className="auth-panel">
        <p className="eyebrow">404</p>
        <h1>Signal lost.</h1>
        <p className="muted">
          This page wandered off while the digest was updating. Try the latest
          edition or head back home.
        </p>
        <div className="auth-form notfound-actions">
          <Link className="primary" to="/">
            Go home
          </Link>
          <Link className="ghost" to="/digest">
            Open digest
          </Link>
        </div>
        <p className="muted notfound-note">
          If you came from an email, generate a fresh digest and try the new link.
        </p>
      </div>
      <div className="auth-visual">
        <div className="orb" />
        <div className="orb small" />
        <div className="stripe" />
        <div className="stripe thin" />
        <div className="dictionary-entry">
          <p className="dictionary-term">ghost link</p>
          <p className="dictionary-pos">noun</p>
          <p className="dictionary-def">
            a URL that wandered off between the week and your click
          </p>
        </div>
      </div>
    </div>
  );
}
