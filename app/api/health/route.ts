// Liveness probe. The iOS app and uptime checks hit this to confirm the
// backend is reachable. No auth, no DB — keep it trivial and fast.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // never cache a health check

export function GET() {
  return NextResponse.json({ ok: true, service: "blissful-catholic-web", time: new Date().toISOString() });
}
