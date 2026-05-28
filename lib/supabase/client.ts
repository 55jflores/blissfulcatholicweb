// Browser-side Supabase client, for the (future) web frontend. Uses the public
// anon key; RLS protects the data. Safe to ship to the client.

import { createBrowserClient } from "@supabase/ssr";

export function getBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
