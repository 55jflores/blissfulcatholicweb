-- Blissful Catholic — Supabase schema (source of truth in git).
--
-- Apply: Supabase dashboard → SQL Editor → New query → paste this file → Run.
-- Idempotent and re-runnable: safe to paste again after edits.
--
-- What lives here: account, billing, and ANONYMOUS analytics only.
-- Personal / sacred data (journal, confession prep, prayer logs, AI memory)
-- stays on-device in SwiftData and is NEVER sent to this database.
--
-- Trust model (see lib/supabase/server.ts):
--   - iOS/web users act via the anon key + their JWT  → RLS applies (auth.uid()).
--   - Webhooks / the AI route act via the service role → RLS bypassed (trusted writes).

-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- Enums ---------------------------------------------------------------------
-- Entitlement tiers. 'free' = content + rosary + basic journal + a daily AI taste.
-- 'plus' = unlimited AI + journal insights + memory. (See docs/monetization.md.)
do $$ begin
  create type entitlement as enum ('free', 'plus');
exception when duplicate_object then null;
end $$;

-- Subscription lifecycle, normalized across Stripe (web) and RevenueCat (App Store).
do $$ begin
  create type subscription_status as enum (
    'trialing', 'active', 'past_due', 'canceled', 'expired'
  );
exception when duplicate_object then null;
end $$;

-- Where a subscription was purchased.
do $$ begin
  create type billing_platform as enum ('app_store', 'stripe');
exception when duplicate_object then null;
end $$;

-- users ---------------------------------------------------------------------
-- A thin profile mirror of auth.users. The row's id IS the auth user id.
-- Auto-created on signup by the trigger below. Holds only non-sacred profile bits;
-- the rich personalization (background, state in life, faith maturity) lives on-device.
create table if not exists public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- subscriptions -------------------------------------------------------------
-- One active billing record per user. Written ONLY by webhooks (service role);
-- the client may read its own row to reflect entitlement in the UI, never write it.
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users (id) on delete cascade,
  entitlement            entitlement         not null default 'free',
  status                 subscription_status not null default 'expired',
  platform               billing_platform,
  -- Provider identifiers, for reconciling webhook events.
  stripe_customer_id     text,
  stripe_subscription_id text,
  app_store_original_txn_id text,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id)
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

-- api_usage -----------------------------------------------------------------
-- Append-only log of AI/proxy calls. Doubles as (a) the rate-limit source and
-- (b) cost analytics. Written by the AI route (service role). Indexed by
-- (user_id, created_at) so "calls in the last window" is a cheap range scan.
create table if not exists public.api_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.users (id) on delete cascade,
  endpoint      text not null,            -- e.g. 'ai/lectio', 'ai/catechism'
  model         text,                     -- e.g. 'claude-opus-4-7'
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now()
);

create index if not exists api_usage_user_time_idx
  on public.api_usage (user_id, created_at desc);

-- feature_events ------------------------------------------------------------
-- ANONYMOUS product analytics. No user_id by design — never join to a person.
-- Anyone (incl. anon key) may insert; nobody reads via the client (dashboards
-- use the service role). A device-scoped UUID groups a session without identifying.
create table if not exists public.feature_events (
  id           bigint generated always as identity primary key,
  event        text not null,            -- e.g. 'rosary_started', 'paywall_viewed'
  properties   jsonb not null default '{}'::jsonb,
  device_id    uuid,                     -- random per-install id, NOT an account id
  app_version  text,
  created_at   timestamptz not null default now()
);

create index if not exists feature_events_event_time_idx
  on public.feature_events (event, created_at desc);

-- updated_at maintenance ----------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Auto-provision a profile row on signup ------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security --------------------------------------------------------
alter table public.users          enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.api_usage      enable row level security;
alter table public.feature_events enable row level security;

-- users: a user sees and edits only their own profile row.
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select using (auth.uid() = id);

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- subscriptions: self-read only. All writes go through webhooks (service role).
drop policy if exists subscriptions_select_self on public.subscriptions;
create policy subscriptions_select_self on public.subscriptions
  for select using (auth.uid() = user_id);

-- api_usage: self-read only (so a user could see their own usage). Writes are
-- service-role from the AI route — no client insert policy on purpose.
drop policy if exists api_usage_select_self on public.api_usage;
create policy api_usage_select_self on public.api_usage
  for select using (auth.uid() = user_id);

-- feature_events: anyone may insert anonymous events; nobody reads via client.
drop policy if exists feature_events_insert_any on public.feature_events;
create policy feature_events_insert_any on public.feature_events
  for insert to anon, authenticated with check (true);

-- ---------------------------------------------------------------------------
-- daily_reflections: the pre-generated shared reflection on the day's Gospel.
-- One row per calendar day (append-by-date; upsert keyed on `date`). Written by
-- /api/cron/daily-reflection and read by /api/daily-reflection — both via the
-- service role. The app never queries this table directly, so RLS is enabled
-- with NO policy: locked to the service role, denied to anon / JWT clients.
create table if not exists public.daily_reflections (
  date            text primary key,          -- 'YYYY-MM-DD'
  gospel_citation text not null,
  body            text not null,
  generated_at    timestamptz not null default now()
);

alter table public.daily_reflections enable row level security;
