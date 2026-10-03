// Reference adapter for pages that follow the Evalix opt-in contract:
//
//   <meta name="evalix-qa" content="enabled">            required — page opts in
//   <meta name="evalix-environment" content="synthetic"> full automation only when "synthetic"
//   <meta name="evalix-test-id" content="...">           optional — used for grading
//   [data-qa-question] (+ -id / -number / -total)        container of the current question
//   [data-qa-complete] or <meta name="evalix-page" content="complete">   completion state
//
// Inside a question it relies only on standard HTML/ARIA patterns (radio inputs, role=radio,
// <select>, role=option) — never on site-specific class names.
import type { ExtractedQuestion, OptionItem, PageInfo } from "../../shared/types";
import type { DomAdapter, Extraction, NextControl, OptionHandle } from "./types";

const LETTERS = "ABCDEFGHIJ";
const NEXT_TEXT = /\b(next|continue|finish|submit)\b/i;
const PROGRESS_TEXT = /^\s*question\s+(\d+)\s+(?:of|\/)\s+(\d+)\s*$/i;
const HIGHLIGHT_ATTR = "data-evalix-highlight";

const meta = (doc: Document, name: string) =>
  doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content?.trim() ?? null;

export const normalize = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Strips a leading "A." / "(B)" / "c)" label that some layouts render inside the option text. */
export const stripLetterPrefix = (s: string) => s.replace(/^\(?[A-Ja-j][.):]\s+/, "");

function labelText(input: HTMLInputElement): string {
  const doc = input.ownerDocument;
  const byFor = input.id ? doc.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
  const label = byFor ?? input.closest("label");
  if (label) return normalize(label.textContent);
  return normalize(input.getAttribute("aria-label") ?? input.value);
}

export class SemanticAdapter implements DomAdapter {
  readonly name = "semantic";

  detect(doc: Document): PageInfo | null {
    if (meta(doc, "evalix-qa") !== "enabled") return null;
    const environment = meta(doc, "evalix-environment") ?? "unknown";
    return {
      adapter: this.name,
      testId: meta(doc, "evalix-test-id") || null,
      environment,
      automationAllowed: environment === "synthetic",
      url: doc.location?.href ?? "",
    };
  }

  isComplete(doc: Document): boolean {
    return meta(doc, "evalix-page") === "complete" || doc.querySelector("[data-qa-complete]") !== null;
  }

  questionRoot(doc: Document): HTMLElement | null {
    return doc.querySelector<HTMLElement>("[data-qa-question]");
  }

  extract(doc: Document): Extraction | null {
    const root = this.questionRoot(doc);
    if (!root) return null;

    const options = this.findOptions(root);
    const text = this.questionText(root);
    if (options.length < 2 || !text) return null;

    const progress = this.progress(root);
    const number = intAttr(root, "data-qa-question-number") ?? progress?.number ?? null;
    const total = intAttr(root, "data-qa-question-total") ?? progress?.total ?? null;

    const items: OptionItem[] = options.map((o) => ({ id: o.id, text: this.optionText(o) }));
    const question: ExtractedQuestion = {
      questionId: root.getAttribute("data-qa-question-id") || (number != null ? `n${number}` : hash(text)),
      questionNumber: number,
      totalQuestions: total,
      text,
      options: items,
    };
    return { question, root, options };
  }

  private findOptions(root: HTMLElement): OptionHandle[] {
    const strategies: [OptionHandle["kind"], () => HTMLElement[]][] = [
      ["radio", () => [...root.querySelectorAll<HTMLElement>('input[type="radio"]')]],
      ["aria-radio", () => [...root.querySelectorAll<HTMLElement>('[role="radio"]')]],
      ["select-option", () => [...root.querySelectorAll<HTMLElement>("select option")].filter((o) => (o as HTMLOptionElement).value !== "")],
      ["aria-option", () => [...root.querySelectorAll<HTMLElement>('[role="option"]')]],
    ];
    for (const [kind, find] of strategies) {
      const els = find();
      if (els.length >= 2) return els.slice(0, LETTERS.length).map((element, i) => ({ id: LETTERS[i], kind, element }));
    }
    return [];
  }

  private optionText(o: OptionHandle): string {
    const raw = o.kind === "radio" ? labelText(o.element as HTMLInputElement) : normalize(o.element.textContent);
    return stripLetterPrefix(raw);
  }

  private questionText(root: HTMLElement): string {
    const candidates = [
      root.querySelector("[data-qa-question-text]"),
      root.querySelector("legend"),
      (() => {
        const select = root.querySelector("select");
        return select?.id ? root.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
      })(),
      ...root.querySelectorAll("h1, h2, h3, h4, p"),
    ];
    for (const el of candidates) {
      const t = normalize(el?.textContent);
      if (t && !PROGRESS_TEXT.test(t)) return t;
    }
    return "";
  }

  private progress(root: HTMLElement): { number: number; total: number } | null {
    for (const el of root.querySelectorAll("p, span, div, h1, h2, h3, h4")) {
      const m = normalize(el.textContent).match(PROGRESS_TEXT);
      if (m) return { number: Number(m[1]), total: Number(m[2]) };
    }
    return null;
  }

  select(option: OptionHandle): void {
    const el = option.element;
    if (option.kind === "select-option") {
      const select = el.closest("select") as HTMLSelectElement;
      select.value = (el as HTMLOptionElement).value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    // click() on a radio input checks it and fires input/change; ARIA widgets handle click themselves.
    el.click();
  }

  isSelected(option: OptionHandle): boolean {
    const el = option.element;
    switch (option.kind) {
      case "radio":
        return (el as HTMLInputElement).checked;
      case "select-option":
        return (el as HTMLOptionElement).selected;
      case "aria-radio":
        return el.getAttribute("aria-checked") === "true";
      case "aria-option":
        return el.getAttribute("aria-selected") === "true";
    }
  }

  findNext(doc: Document): NextControl | null {
    const selector = 'button, input[type="submit"], input[type="button"], a, [role="button"]';
    const scopes: ParentNode[] = [
      ...doc.querySelectorAll("[data-qa-nav]"),
      this.questionRoot(doc)?.closest("form") ?? doc,
      doc,
    ];
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll<HTMLElement>(selector)) {
        const label = normalize(el instanceof HTMLInputElement ? el.value : el.textContent || el.getAttribute("aria-label"));
        if (!NEXT_TEXT.test(label)) continue;
        // An answer option that happens to say "next" is not navigation.
        if (el.closest("[data-qa-question]") && !el.closest("[data-qa-nav]")) continue;
        const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
        return { element: el, disabled, label };
      }
    }
    return null;
  }

  highlight(option: OptionHandle | null, root: HTMLElement): void {
    root.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((el) => {
      el.removeAttribute(HIGHLIGHT_ATTR);
      (el as HTMLElement).style.outline = "";
      (el as HTMLElement).style.outlineOffset = "";
    });
    if (!option) return;
    // Highlight the visible element (a radio's label, a select itself).
    const target =
      option.kind === "radio"
        ? (option.element.closest("label") as HTMLElement | null) ?? option.element
        : option.kind === "select-option"
          ? (option.element.closest("select") as HTMLElement)
          : option.element;
    target.setAttribute(HIGHLIGHT_ATTR, option.id);
    target.style.outline = "3px dashed #f59e0b";
    target.style.outlineOffset = "2px";
  }
}

function intAttr(el: Element, name: string): number | null {
  const v = el.getAttribute(name);
  const n = v == null ? NaN : parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}`;
}
