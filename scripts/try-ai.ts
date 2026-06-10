// Standalone test for the Claude integration — bypasses auth/entitlement/rate-limit
// so you can confirm the API key works and the prompts produce good, orthodox
// replies. It uses the SAME foundation + feature prompts the real route uses.
//
// Run (loads ANTHROPIC_API_KEY from .env.local):
//   npx tsx --env-file=.env.local scripts/try-ai.ts
//   npx tsx --env-file=.env.local scripts/try-ai.ts catechism "What is grace?"
//
// Args: [feature] [question...]   feature defaults to "daily".

import Anthropic from "@anthropic-ai/sdk";
import { FOUNDATION_SYSTEM_PROMPT } from "../lib/prompts/foundation";
import { FEATURE_PROMPTS, isFeatureKey } from "../lib/prompts/features";

const [, , maybeFeature, ...rest] = process.argv;

const feature = isFeatureKey(maybeFeature) ? maybeFeature : "daily";
const question =
  (isFeatureKey(maybeFeature) ? rest : [maybeFeature, ...rest])
    .filter(Boolean)
    .join(" ") || "What should I reflect on in prayer today?";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("✗ ANTHROPIC_API_KEY not set. Run with: --env-file=.env.local");
    process.exit(1);
  }

  console.log(`\n  feature:  ${feature}`);
  console.log(`  question: ${question}\n  ${"─".repeat(50)}\n`);

  const anthropic = new Anthropic();
  const stream = anthropic.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: FOUNDATION_SYSTEM_PROMPT },
      { type: "text", text: FEATURE_PROMPTS[feature], cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: question }],
  });

  stream.on("text", (delta) => process.stdout.write(delta));

  const final = await stream.finalMessage();
  console.log(`\n\n  ${"─".repeat(50)}`);
  console.log(
    `  stop: ${final.stop_reason}  |  in: ${final.usage.input_tokens} tok  out: ${final.usage.output_tokens} tok` +
      `  |  cache read: ${final.usage.cache_read_input_tokens ?? 0}\n`
  );
}

main().catch((err) => {
  console.error("\n✗ Error:", err?.message ?? err);
  process.exit(1);
});
