// AI proxy — the route that mandates a backend.
//
// Pipeline per request:
//   1. Authenticate the caller from their Supabase JWT (Authorization: Bearer …).
//   2. Gate on entitlement — free tier gets the "daily" taste; richer features need Plus.
//   3. Rate-limit per user (rolling 24h, via api_usage).
//   4. Build the system prompt: FOUNDATION + feature instructions (cached) + personalization.
//   5. Stream Claude's reply back as SSE.
//   6. Log token usage to api_usage (the rate-limit source + cost ledger).
//
// None of steps 1–3 or 6 can live on the client — that's the whole point of the proxy.

import Anthropic from "@anthropic-ai/sdk";
import { FOUNDATION_SYSTEM_PROMPT } from "@/lib/prompts/foundation";
import { FEATURE_PROMPTS, FREE_FEATURES, isFeatureKey } from "@/lib/prompts/features";
import {
  checkRateLimit,
  getCaller,
  getEntitlement,
  logUsage,
} from "@/lib/ai/gating";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // service-role Supabase + streaming need the Node runtime

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 2048; // a companion reply, not an essay (see foundation prompt: "be concise")

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

type ClientMessage = { role: "user" | "assistant"; content: string };

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function jsonError(status: number, code: string, message: string, extra?: object) {
  return Response.json({ error: code, message, ...extra }, { status });
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError(503, "not_configured", "ANTHROPIC_API_KEY is not set on the server.");
  }

  // 1. Authenticate ----------------------------------------------------------
  const token = bearerToken(req);
  if (!token) {
    return jsonError(401, "unauthenticated", "Missing bearer token.");
  }
  const caller = await getCaller(token);
  if (!caller) {
    return jsonError(401, "unauthenticated", "Invalid or expired session.");
  }

  // Parse + validate body ----------------------------------------------------
  let body: { feature?: unknown; messages?: unknown; personalization?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Body must be valid JSON.");
  }
  if (!isFeatureKey(body.feature)) {
    return jsonError(400, "bad_request", "Unknown or missing 'feature'.");
  }
  const feature = body.feature;
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, "bad_request", "'messages' must be a non-empty array.");
  }
  const personalization =
    typeof body.personalization === "string" ? body.personalization : null;

  // 2. Entitlement gate ------------------------------------------------------
  const entitlement = await getEntitlement(caller.userId);
  if (!FREE_FEATURES.has(feature) && entitlement !== "plus") {
    return jsonError(
      403,
      "upgrade_required",
      "This feature is part of Blissful Catholic Plus.",
      { feature, entitlement }
    );
  }

  // 3. Rate limit ------------------------------------------------------------
  const rate = await checkRateLimit(caller.userId, entitlement);
  if (!rate.allowed) {
    return jsonError(
      429,
      "rate_limited",
      "You've reached today's limit. Please try again later.",
      { used: rate.used, limit: rate.limit }
    );
  }

  // 4. System prompt — stable prefix (foundation + feature) is cached; the
  //    per-user personalization block trails it, after the cache breakpoint.
  //    NOTE: caching only engages once the prefix exceeds ~4096 tokens (Opus 4.7
  //    minimum). Today's prompt is small, so this is a no-op until feature content
  //    (the day's readings, Catechism passages, etc.) is injected — but the
  //    placement is correct for when it grows. (See shared/prompt-caching.md.)
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: FOUNDATION_SYSTEM_PROMPT },
    {
      type: "text",
      text: FEATURE_PROMPTS[feature],
      cache_control: { type: "ephemeral" },
    },
  ];
  if (personalization) {
    system.push({ type: "text", text: personalization });
  }

  // 5. Stream the reply ------------------------------------------------------
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const claude = anthropic.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          thinking: { type: "adaptive" }, // Claude decides depth; pairs with effort
          output_config: { effort: "medium" }, // balance pastoral quality vs. latency
          system,
          messages: messages as ClientMessage[],
        });

        for await (const event of claude) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            send({ type: "text", text: event.delta.text });
          }
        }

        const final = await claude.finalMessage();
        send({ type: "done", stop_reason: final.stop_reason });

        // 6. Log usage (fire-and-forget relative to the stream close).
        await logUsage({
          userId: caller.userId,
          endpoint: `ai/${feature}`,
          model: MODEL,
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("AI stream error:", message);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
