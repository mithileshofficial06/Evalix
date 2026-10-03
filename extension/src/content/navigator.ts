// Advancing to the next question: find an enabled Next control, click it, confirm the page moved.
import type { DomAdapter } from "./adapters/types";
import { signatureOf, waitFor, WaitTimeoutError } from "./observer";

export interface NavigateOptions {
  /** How long the Next control may stay disabled after selecting (pages often validate async). */
  enableTimeoutMs: number;
  /** How long to wait for the page to react to a click before clicking once more. */
  reactTimeoutMs: number;
  /** Pause before clicking so the page's own selection handlers finish. */
  actionDelayMs: number;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NavigationError extends Error {}

/**
 * Clicks Next and resolves once the page has left `currentSignature` (new question, completion,
 * or the document is unloading). Rejects with NavigationError if the page never reacts.
 */
export async function advance(adapter: DomAdapter, doc: Document, currentSignature: string, opts: NavigateOptions): Promise<void> {
  const left = () => {
    if (adapter.isComplete(doc)) return true;
    const e = adapter.extract(doc);
    // No question rendered (spinner) or a different one => the page reacted.
    return !e || signatureOf(e) !== currentSignature;
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    let next;
    try {
      next = await waitFor(
        () => {
          const n = adapter.findNext(doc);
          return n && !n.disabled ? n : null;
        },
        { timeoutMs: opts.enableTimeoutMs, signal: opts.signal },
      );
    } catch (err) {
      if (err instanceof WaitTimeoutError) {
        const found = adapter.findNext(doc);
        throw new NavigationError(found ? `Next control "${found.label}" stayed disabled` : "No Next/Finish control found on the page");
      }
      throw err;
    }

    await sleep(opts.actionDelayMs);
    next.element.click();

    try {
      await waitFor(left, { timeoutMs: opts.reactTimeoutMs, signal: opts.signal });
      return;
    } catch (err) {
      if (!(err instanceof WaitTimeoutError)) throw err;
      // A full-page navigation may already be in flight — in that case this script is about to be
      // torn down and the next page load resumes the session.
    }
  }
  throw new NavigationError("Page did not advance after clicking Next twice");
}
