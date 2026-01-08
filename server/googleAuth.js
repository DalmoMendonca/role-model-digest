import "./env.js";
import bcrypt from "bcryptjs";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { nanoid } from "nanoid";

export function setupGoogleAuth(db) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback"
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile?.emails?.[0]?.value?.toLowerCase();
          if (!email) {
            return done(new Error("Google account email is required"));
          }

          const displayName =
            profile?.displayName ||
            [profile?.name?.givenName, profile?.name?.familyName]
              .filter(Boolean)
              .join(" ") ||
            email.split("@")[0];

          let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

          if (!user) {
            const userId = nanoid();
            const passwordHash = bcrypt.hashSync(nanoid(), 10);
            db.prepare(
              "INSERT INTO users (id, email, password_hash, display_name, weekly_email_opt_in, created_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(userId, email, passwordHash, displayName, 1, new Date().toISOString());
            
            user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id, done) => {
    try {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });
}
