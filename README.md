# Role Model Digest
A weekly intelligence brief on a living role model, blending AI curation with a social layer for shared inspiration.

Role Model Digest helps you keep track of the online activity of a single person you admire: a bio you can trust, a weekly narrative with key highlights, and a place to compare digests with peers.

## What it delivers
- AI-generated bio, weekly digest, and per-item summaries grounded in real sources.
- Source intelligence that prioritizes official profiles and recent signals across news, web, video, and social.
- Social graph: peer invites, shared timelines, reactions, and threaded comments.
- Shareable public digest links with a read-only experience.
- Automated weekly delivery via scheduler plus opt-in email digests.

## Architecture at a glance
```
React + Vite (client)
  -> Firebase Auth (Google)
  -> API (Firebase Functions / Express)
     -> Firestore or SQLite
     -> Agent pipeline (validation, sources, summaries)
     -> Email service (Nodemailer)
     -> Scheduler (Cloud Scheduler / node-cron)
```

There are two backend targets in this repo:
- `functions/`: Firebase Functions + Firestore (production-grade flow, used by the client).
- `server/`: Express + SQLite (local-first, same agent pipeline and data model).

## The AI pipeline
1. Role model validation checks living status and public presence using Serper + Wikidata.
2. Official profile discovery uses Wikidata claims and search fallback.
3. Source collection pulls recent news, web, social, and video signals and dedupes them.
4. Digest generation uses structured JSON outputs from OpenAI with guardrails.
5. Item summarization enriches articles via lightweight content extraction.
6. Digest summary synthesizes the weekly theme with a hard length constraint.
7. Email pipeline renders a responsive HTML digest with share and social links.

## Technical highlights
- **Guardrailed LLM outputs:** JSON-only responses, fallback summaries, and content hashing to avoid drift.
- **Source intelligence:** official profile matching, YouTube feed ingestion, OpenGraph image sniffing, and URL normalization.
- **Embed orchestration:** dynamic, cached script loading for X, Instagram, TikTok, plus safe fallbacks.
- **Social mechanics:** peer graph, digest reactions, and threaded comments with per-user reaction state.
- **Admin visibility:** aggregate metrics and full user-role model-digest graph for moderation and analytics.

## Code tour
- Client routing and auth: `src/App.jsx`, `src/firebase.js`
- Digest experience and embeds: `src/pages/DigestPage.jsx`
- Social timeline, reactions, comments: `src/pages/SocialPage.jsx`
- Public share experience: `src/pages/PublicDigestPage.jsx`
- LLM pipeline: `functions/agents/` and `server/agents/`
- Digest orchestration and email rendering: `functions/digestService.js`, `server/digestService.js`
- Validation + sourcing heuristics: `functions/agents/roleModelValidator.js`, `functions/agents/sourceAgent.js`
- Firebase API surface: `functions/index.js`
- SQLite schema and migrations: `server/db.js`

## Data model at a glance
Firestore collections (functions backend):
- `users`: profile, auth metadata, preferences, current role model
- `roleModels`: bio, notes, image, active flag
- `digests`: weekly summaries, topics, items, email status
- `peers` and `peerRequests`: social graph + invites
- `digestReactions` and `digestComments`: engagement layer

SQLite tables (server backend):
- `users`, `role_models`, `role_model_sources`
- `digest_weeks`, `digest_items`
- `peers`, `peer_requests`

## Local development (Firebase Functions path)
1. Install dependencies:
   - `npm install`
   - `cd functions && npm install`
2. Configure env:
   - Copy `.env.example` to `.env` for client settings.
   - Create `functions/.env` for server-side keys.
3. Start:
   - `npm run dev` (Vite + Firebase emulators)

## Local development (Express + SQLite path)
1. Configure `VITE_API_URL` to `http://localhost:8787`.
2. Set `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` in `.env`.
3. Run the server:
   - `node server/index.js`
4. Start the client:
   - `npm run dev:client`

## Environment variables (core)
Client:
- `VITE_API_URL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
  `VITE_FIREBASE_STORAGE_BUCKET_ALT`,
  `VITE_ADMIN_EMAIL`

Server / Functions (optional but recommended):
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `SERPER_API_KEY`
- `ALLOW_SOURCE_FETCH`, `ALLOW_WIKIDATA_LOOKUP`
- `SMTP_URL`, `EMAIL_FROM`
- `CLIENT_ORIGIN`, `CLIENT_ORIGIN_DEV`, `CORS_ORIGIN`, `CRON_TIMEZONE`, `ADMIN_EMAIL`

## Deployment
- Client: `netlify.toml` (Vite build, SPA redirects).
- Functions: `firebase.json` (Functions + emulators).

## Why this stands out
Role Model Digest is a layered signal-processing system that fuses search intelligence, LLM structure, and social context into one weekly digest. Every layer has guardrails, fallbacks, and clear data ownership.
