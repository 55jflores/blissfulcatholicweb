# Blissful Catholic — Web / Backend

Next.js (App Router, TypeScript) app that serves the **iOS app's API today** and the **blissfulcatholic.com web frontend later**. Separate from the iOS repo.

## Architecture (hybrid)

- **Auth + simple profile/analytics reads** → iOS talks to **Supabase directly** (RLS enforces per-user access).
- **AI + anything needing secrets or gating** → iOS → **this Next.js app** → Claude. The Anthropic key, theological safety filter, rate limiting, and subscription checks must be server-side.
- **Subscription writes** → Stripe / RevenueCat **webhooks → Next.js → Supabase** (service role).

Personal / sacred data (journal, confession prep, prayer logs, AI memory) stays **on-device in SwiftData** and never reaches this database.

## What's in here

| Path | Purpose |
|---|---|
| `app/page.tsx` | Placeholder parchment landing page |
| `app/api/health/route.ts` | `GET` liveness probe → `{ ok: true }` |
| `app/api/ai/route.ts` | AI proxy — **501 stub** until its dedicated step |
| `lib/supabase/server.ts` | Server clients: cookie (web), service-role (webhooks), JWT (iOS) |
| `lib/supabase/client.ts` | Browser Supabase client |
| `lib/prompts/foundation.ts` | Master Catholic system prompt |
| `supabase/schema.sql` | DB schema + RLS (source of truth) |

## Setup

```bash
npm install
```

### 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Dashboard → **SQL Editor** → **New query** → paste all of `supabase/schema.sql` → **Run**. (Idempotent — safe to re-run after edits.)
3. Confirm `users`, `subscriptions`, `api_usage`, `feature_events` appear in the **Table Editor**.

### 2. Configure auth providers (when ready)

Dashboard → **Authentication → Providers**. Enable **Email** and **Google** to start; **Sign in with Apple** needs an Apple Developer account (Service ID + key) and can be added later with no schema changes. The `on_auth_user_created` trigger auto-creates each user's `public.users` row on signup.

### 3. Environment

```bash
cp .env.example .env.local
```

Fill in from Supabase **Settings → API** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com). Never commit `.env.local`.

### 4. Run

```bash
npm run dev
```

Verify: open <http://localhost:3000> (landing page) and <http://localhost:3000/api/health> (`{ "ok": true }`).

## Deploy

Push to GitHub and import into **Vercel**. Add the same env vars in the Vercel project settings. (Railway is the fallback if persistent rate-limiting or long streaming becomes necessary.)

## Not done yet

- Real AI route (Claude integration, safety filter, rate limit via `api_usage`, entitlement gating) — built with the `claude-api` skill in its own step.
- Stripe / RevenueCat webhook handlers.
- The actual web marketing frontend.
