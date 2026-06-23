// Generates the shared daily reflection for the pre-generation cron.
// Mirrors FEATURE_MODEL.daily in app/api/ai/route.ts — same model, foundation
// prompt, and voice as the in-app "Reflect with your companion" daily feature,
// so the always-on card and the companion sheet read the same.
// Non-streaming: ~180 words is well under any timeout.

import Anthropic from "@anthropic-ai/sdk";
import { FOUNDATION_SYSTEM_PROMPT } from "@/lib/prompts/foundation";

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

const MODEL = "claude-sonnet-4-6"; // == SONNET in app/api/ai/route.ts

// The card's specific task + format. The orthodox/pastoral voice comes from
// FOUNDATION_SYSTEM_PROMPT (shared with the companion); this only sets the
// length and shape the card needs. (Lifted from the iOS DailyReflectionStore.)
function buildUserPrompt(citation: string, gospelText: string): string {
  return `Write a short Catholic devotional reflection — about 150 to 180 words, in two short paragraphs — on today's Gospel:

${citation}

"${gospelText}"

Tone: warm, prayerful, lectionary-grounded. Address the reader directly ("you"). Surface one specific insight from the passage, then offer a brief invitation to prayer or to a small, concrete spiritual step. Avoid clichés and hedging. Do not begin with a title.`;
}

export async function generateReflection(citation: string, gospelText: string): Promise<string> {
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: FOUNDATION_SYSTEM_PROMPT },
  ];
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: { effort: "low" }, // mirrors FEATURE_MODEL.daily
    system,
    messages: [{ role: "user", content: buildUserPrompt(citation, gospelText) }],
  });
  const block = res.content.find((b) => b.type === "text");
  return block && "text" in block ? block.text.trim() : "";
}
