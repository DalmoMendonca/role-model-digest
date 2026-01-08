import "./env.js";
import jwt from "jsonwebtoken";

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";

export function createSessionToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      displayName: user.display_name || user.displayName
    },
    SESSION_SECRET,
    { expiresIn: "14d" }
  );
}

export function requireAuth(db) {
  return (req, res, next) => {
    const token = req.cookies?.session;
    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const payload = jwt.verify(token, SESSION_SECRET);
      const user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(payload.sub);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      req.user = user;
      return next();
    } catch (error) {
      return res.status(401).json({ error: "Invalid session" });
    }
  };
}

export function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 14
  };
}
