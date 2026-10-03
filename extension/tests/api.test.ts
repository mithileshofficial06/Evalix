import { describe, expect, it, vi } from "vitest";
import { ApiError, requestJson } from "../src/background/api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("requestJson", () => {
  it("returns parsed JSON on success", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { status: "ok" }));
    await expect(requestJson("http://x/health", {}, {}, f)).resolves.toEqual({ status: "ok" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx then succeeds", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(502, { detail: "bad gateway" }))
      .mockResolvedValueOnce(json(200, { answer: "B" }));
    await expect(requestJson("http://x", {}, { retries: 2, backoffMs: 1 }, f)).resolves.toEqual({ answer: "B" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("retries network errors and gives up after the limit", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(requestJson("http://x", {}, { retries: 2, backoffMs: 1 }, f)).rejects.toBeInstanceOf(ApiError);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry 4xx", async () => {
    const f = vi.fn().mockResolvedValue(json(422, { detail: "invalid" }));
    await expect(requestJson("http://x", {}, { retries: 3, backoffMs: 1 }, f)).rejects.toMatchObject({ status: 422 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("times out slow requests", async () => {
    const f = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))),
      ),
    );
    await expect(
      requestJson("http://x", {}, { retries: 0, timeoutMs: 20 }, f as unknown as typeof fetch),
    ).rejects.toThrow(/Timed out/);
  });
});
