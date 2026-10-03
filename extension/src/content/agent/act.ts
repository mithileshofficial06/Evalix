// ACT: executes validated, structured actions on the page — never free-form instructions.
import { BROWSER_ACTIONS, type BrowserAction } from "../../shared/types";
import type { OptionHandle } from "../adapters/types";
import { AbortedError } from "../observer";

export class ActionError extends Error {}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AbortedError("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const TYPABLE = (el: HTMLElement) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !["radio", "checkbox", "submit", "button", "hidden", "file", "image", "reset"].includes(el.type));

/**
 * Checks an AI action against what was actually observed. Returns an error message, or null if the
 * action is safe to run. The backend validates too; this is the last gate before touching the page.
 */
export function validateAction(a: BrowserAction, registry: Map<string, HTMLElement>, pageUrl: string): string | null {
  if (!BROWSER_ACTIONS.includes(a.action)) return `Unknown action "${a.action}"`;
  const el = a.target ? registry.get(a.target) : undefined;
  if (a.target && !el) return `Target ${a.target} was not observed on the page`;
  if (el && !el.isConnected) return `Target ${a.target} is no longer on the page`;
  switch (a.action) {
    case "click":
      return el ? null : "click needs a target";
    case "type":
      if (!el || !TYPABLE(el)) return "type needs a text field as target";
      return a.value == null ? "type needs a value" : null;
    case "wait": {
      const ms = Number(a.value ?? 1000);
      return Number.isFinite(ms) && ms >= 0 && ms <= 5000 ? null : "wait must be 0–5000 ms";
    }
    case "scroll":
      return el || ["up", "down", null].includes((a.value ?? null)?.toLowerCase() ?? null) ? null : "scroll must be up or down";
    case "navigate":
      try {
        const to = new URL(a.value ?? "", pageUrl);
        return to.origin === new URL(pageUrl).origin ? null : "navigate must stay on the assessment's site";
      } catch {
        return "navigate needs a valid URL";
      }
    default:
      return null; // select_answer / finish / retry are decisions for the loop, not page actions
  }
}

/** Runs a validated page action. Loop-level decisions (finish, retry, select_answer) are no-ops here. */
export async function executeAction(a: BrowserAction, registry: Map<string, HTMLElement>, doc: Document, signal?: AbortSignal) {
  const el = a.target ? registry.get(a.target) : undefined;
  switch (a.action) {
    case "click":
      if (el instanceof HTMLOptionElement) selectNative(el);
      else el!.click();
      return;
    case "type": {
      const field = el as HTMLInputElement | HTMLTextAreaElement;
      field.focus();
      // Use the native setter so frameworks that track the value see the change.
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, a.value ?? "");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    case "scroll":
      if (el) el.scrollIntoView?.({ block: "center" });
      else doc.defaultView?.scrollBy?.(0, (a.value?.toLowerCase() === "up" ? -1 : 1) * (doc.defaultView.innerHeight * 0.8));
      return;
    case "wait":
      await sleep(Number(a.value ?? 1000), signal);
      return;
    case "navigate":
      doc.defaultView?.location.assign(new URL(a.value!, doc.location.href).href);
      return;
    default:
      return;
  }
}

function selectNative(option: HTMLOptionElement) {
  const select = option.closest("select") as HTMLSelectElement;
  select.value = option.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---- Interaction strategies ---------------------------------------------------------------------
// Pages react to different events. When a plain click does not register, the agent escalates
// through progressively more "human" interactions instead of repeating the same thing.

export interface Strategy {
  name: string;
  run(el: HTMLElement): void;
}

/** Runs a strategy; an exception counts as "did not work" (the caller verifies the effect anyway). */
export function runStrategy(strategy: Strategy, el: HTMLElement): string | null {
  try {
    strategy.run(el);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

function pointerSequence(el: HTMLElement) {
  const view = el.ownerDocument.defaultView!;
  const opts = { bubbles: true, cancelable: true, button: 0 };
  const Pointer = (view as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent ?? view.MouseEvent;
  el.dispatchEvent(new Pointer("pointerdown", opts));
  el.dispatchEvent(new view.MouseEvent("mousedown", opts));
  el.focus?.();
  el.dispatchEvent(new Pointer("pointerup", opts));
  el.dispatchEvent(new view.MouseEvent("mouseup", opts));
  el.dispatchEvent(new view.MouseEvent("click", opts));
}

function keyboard(el: HTMLElement) {
  const view = el.ownerDocument.defaultView!;
  el.focus?.();
  for (const key of [" ", "Enter"]) {
    const init = { key, code: key === " " ? "Space" : "Enter", bubbles: true, cancelable: true };
    el.dispatchEvent(new view.KeyboardEvent("keydown", init));
    el.dispatchEvent(new view.KeyboardEvent("keyup", init));
  }
}

/** Ways to select an answer choice, in escalation order. */
export function selectStrategies(option: OptionHandle, nativeSelect: (o: OptionHandle) => void): Strategy[] {
  if (option.kind === "select-option") return [{ name: "set select value", run: () => nativeSelect(option) }];
  const label = (el: HTMLElement) => (el instanceof HTMLInputElement ? (el.labels?.[0] ?? el.closest("label")) : null);
  return [
    { name: "click", run: () => nativeSelect(option) },
    {
      name: "click label",
      run: (el) => (label(el) ?? el.querySelector<HTMLElement>("input, [role='radio'], button") ?? el).click(),
    },
    { name: "pointer events", run: pointerSequence },
    { name: "keyboard", run: keyboard },
  ];
}

/** Ways to press a navigation control, in escalation order. */
export function pressStrategies(): Strategy[] {
  return [
    { name: "click", run: (el) => el.click() },
    {
      name: "submit form",
      run: (el) => {
        const form = el.closest("form");
        if (form && (el as HTMLButtonElement).type === "submit") form.requestSubmit(el as HTMLButtonElement);
        else pointerSequence(el);
      },
    },
    { name: "keyboard", run: keyboard },
  ];
}
