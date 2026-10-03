// HTTP client for the local Evalix backend: per-attempt timeout + retry with exponential backoff.
import type { AnswerRequest, AnswerResponse, GradingReport, HealthResponse } from "../shared/types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
  }
}

export interface RetryOptions {
  retries: number;
  timeoutMs: number;
  backoffMs: number;
}

const DEFAULT_RETRY: RetryOptions = { retries: 2, timeoutMs: 60_000, backoffMs: 500 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  opts: Partial<RetryOptions> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const { retries, timeoutMs, backoffMs } = { ...DEFAULT_RETRY, ...opts };
  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      if (res.ok) return (await res.json()) as T;
      const detail = await res.text().catch(() => "");
      // 4xx (except 408/429) means the request itself is wrong — retrying won't help.
      const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
      lastError = new ApiError(`HTTP ${res.status}: ${detail.slice(0, 300)}`, res.status, retryable);
    } catch (err) {
      const aborted = (err as Error).name === "AbortError";
      lastError = new ApiError(
        aborted ? `Timed out after ${timeoutMs} ms` : `Network error: ${(err as Error).message}`,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!lastError.retryable) break;
  }
  throw lastError!;
}

export const api = {
  health: (base: string) => requestJson<HealthResponse>(`${base}/health`, {}, { retries: 0, timeoutMs: 3000 }),

  // The backend already retries and falls back between providers (worst case ~2 × 3 × timeout),
  // so wait long enough for that and only retry here for transport failures.
  answer: (base: string, body: AnswerRequest) =>
    requestJson<AnswerResponse>(`${base}/answer`, { method: "POST", body: JSON.stringify(body) }, { retries: 1, timeoutMs: 120_000 }),

  gradingReport: (base: string, body: unknown) =>
    requestJson<GradingReport>(`${base}/grading/report`, { method: "POST", body: JSON.stringify(body) }),
};
