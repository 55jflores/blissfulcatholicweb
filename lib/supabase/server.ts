// Server-side Supabase clients — three, by trust context:
// - getServerSupabase(): cookie-bound, acts as the signed-in WEB user (RLS applies).
// - getSupabaseAdmin(): service-role, BYPASSES RLS. Server-only. For webhooks/trusted writes.
// - getSupabaseForToken(jwt): acts as the iOS user identified by their access token (RLS applies).

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Auth-aware client for Next.js Server Components / Route Handlers (web frontend). */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — safe to ignore.
        }
      },
    },
  });
}

/** Service-role client. Full access, bypasses RLS. NEVER import from client code. */
export function getSupabaseAdmin() {
  return createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Acts as the iOS user identified by `accessToken` (sent in the Authorization header). */
export function getSupabaseForToken(accessToken: string) {
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
