// MutationObserver-based waiting for asynchronously rendered pages.
import type { DomAdapter, Extraction } from "./adapters/types";

export class WaitTimeoutError extends Error {}
export class AbortedError extends Error {}

export interface WaitOptions {
  timeoutMs: number;
  root?: Node;
  signal?: AbortSignal;
  /** Fallback poll for changes a MutationObserver can't see (e.g. a property-only change). */
  pollMs?: number;
}

/** Resolves with the first truthy value of `check`, re-evaluated on every DOM mutation. */
export function waitFor<T>(check: () => T | null | undefined | false, opts: WaitOptions): Promise<T> {
  const { timeoutMs, root = document, signal, pollMs = 250 } = opts;
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError("aborted"));
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      clearInterval(poll);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const evaluate = () => {
      try {
        const v = check();
        if (v) finish(() => resolve(v));
      } catch (err) {
        finish(() => reject(err));
      }
    };
    const onAbort = () => finish(() => reject(new AbortedError("aborted")));
    const observer = new MutationObserver(evaluate);
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    const timer = setTimeout(() => finish(() => reject(new WaitTimeoutError(`Timed out after ${timeoutMs} ms`))), timeoutMs);
    const poll = setInterval(evaluate, pollMs);
    signal?.addEventListener("abort", onAbort);
    evaluate();
  });
}

/** Resolves once `root` has had no mutations for `quietMs` (or after `maxMs` regardless). */
export function waitForQuiet(root: Node, quietMs: number, maxMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const done = () => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      resolve();
    };
    const observer = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(done, quietMs);
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    quiet = setTimeout(done, quietMs);
    const cap = setTimeout(done, maxMs);
  });
}

export const signatureOf = (e: Extraction) =>
  [e.question.questionId, e.question.text, ...e.question.options.map((o) => o.text)].join("|");

export type NextState = { kind: "question"; extraction: Extraction } | { kind: "complete" };

/**
 * Waits until either the assessment is complete or a fully rendered question whose signature
 * differs from `previousSignature` is present and the DOM around it has settled.
 */
export async function waitForNextState(
  adapter: DomAdapter,
  doc: Document,
  opts: { previousSignature: string | null; timeoutMs: number; quietMs?: number; signal?: AbortSignal },
): Promise<NextState> {
  const { previousSignature, timeoutMs, quietMs = 300, signal } = opts;
  for (;;) {
    const found = await waitFor<NextState>(
      () => {
        if (adapter.isComplete(doc)) return { kind: "complete" };
        const e = adapter.extract(doc);
        return e && signatureOf(e) !== previousSignature ? { kind: "question", extraction: e } : null;
      },
      { timeoutMs, root: doc.documentElement ?? doc, signal },
    );
    if (found.kind === "complete") return found;
    // Options may still be streaming in; let the question settle, then re-read it.
    await waitForQuiet(found.extraction.root, quietMs);
    const settled = adapter.extract(doc);
    if (settled && signatureOf(settled) !== previousSignature) return { kind: "question", extraction: settled };
  }
}
