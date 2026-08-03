import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    aiBaseUrl: "https://ai.test",
    aiModel: "test-model",
    aiApiKey: "test-key",
    aiTimeoutMs: 30,
  },
}));

import { callLlm } from "../ai/llm.client.js";

function okResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

describe("llm.client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends an OpenAI-compatible request with system/user messages", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse('{"action":"check"}'));

    const result = await callLlm("SYS", "USER");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://ai.test/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(200);
    // Reasoning models must have thinking disabled, otherwise reasoning
    // tokens exhaust max_tokens and content comes back empty.
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USER" },
    ]);
    expect(result).toEqual({ action: "check" });
  });

  it("strips markdown code fences before parsing", async () => {
    vi.mocked(fetch).mockResolvedValue(
      okResponse('```json\n{"action":"raise","amount":4}\n```'),
    );
    const result = await callLlm("SYS", "USER");
    expect(result).toEqual({ action: "raise", amount: 4 });
  });

  it("returns null when the content is not valid JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse("我选择弃牌"));
    await expect(callLlm("SYS", "USER")).resolves.toBeNull();
  });

  it("returns null when the response has no content", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    } as Response);
    await expect(callLlm("SYS", "USER")).resolves.toBeNull();
  });

  it("returns null on HTTP error without throwing", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(callLlm("SYS", "USER")).resolves.toBeNull();
  });

  it("aborts after the configured timeout", async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    await expect(callLlm("SYS", "USER")).resolves.toBeNull();
  });

  it("never logs the api key or full response body", async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.join(" "));
    });
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
    await callLlm("SYS", "USER");
    for (const line of errors) {
      expect(String(line)).not.toContain("test-key");
    }
  });
});
