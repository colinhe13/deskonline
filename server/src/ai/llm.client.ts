import { config } from "../config.js";

export interface LlmDecision {
  action: string;
  amount?: number;
}

// Strips optional markdown code fences some models add despite instructions.
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1].trim() : trimmed;
}

// Calls an OpenAI-compatible chat/completions endpoint. Returns the parsed
// decision object, or null on any failure (network, timeout, bad output);
// callers must fall back to a rule-based action.
export async function callLlm(
  systemPrompt: string,
  userContent: string,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.aiTimeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${config.aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.aiApiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 200,
        // deepseek-v4-flash is a reasoning model: its thinking tokens would
        // consume the whole max_tokens budget and leave content empty.
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[ai] LLM request failed: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(stripFences(content)) as Record<string, unknown>;
    console.info(`[ai] LLM decision in ${Date.now() - startedAt}ms`);
    return parsed;
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.error(`[ai] LLM call ${reason} after ${Date.now() - startedAt}ms`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
