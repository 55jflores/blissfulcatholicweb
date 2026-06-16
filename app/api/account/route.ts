// Account deletion — App Store Guideline 5.1.1(v) requires in-app account
// deletion, and the client can't delete its own auth.users row, so it lands here.
//
// DELETE /api/account, Authorization: Bearer <Supabase JWT>.
//
// One admin call is enough: deleting the auth.users row cascades through
// public.users → subscriptions → api_usage (see supabase/schema.sql).
// feature_events carries no user_id, so nothing to remove there.

import { getCaller } from "@/lib/ai/gating";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // secret-key Supabase client

function jsonError(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

export async function DELETE(req: Request) {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : null;
  if (!token) {
    return jsonError(401, "unauthenticated", "Missing bearer token.");
  }

  // The caller can only ever delete themselves — the user id comes from the
  // verified JWT, never from the request body.
  const caller = await getCaller(token);
  if (!caller) {
    return jsonError(401, "unauthenticated", "Invalid or expired token.");
  }

  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(caller.userId);
  if (error) {
    console.error("account deletion failed", { userId: caller.userId, error });
    return jsonError(500, "delete_failed", "Couldn't delete the account.");
  }

  return Response.json({ ok: true });
}
