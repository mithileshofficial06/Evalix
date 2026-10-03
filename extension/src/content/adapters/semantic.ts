// Reference adapter for pages that follow the Evalix opt-in contract:
//
//   <meta name="evalix-qa" content="enabled">            required — page opts in
//   <meta name="evalix-environment" content="synthetic"> full automation only when "synthetic"
//   <meta name="evalix-test-id" content="...">           optional — used for grading
//
// Everything else is optional. `data-qa-question` (+ -id / -number / -total), `data-qa-nav` and
// `data-qa-complete` are used as hints when a page provides them; without them the adapter infers
// the question, its answer choices and the Next control from what elements are (see infer.ts).
// It never relies on site-specific class names, ids or positions.
import type { ExtractedQuestion, OptionItem, PageInfo } from "../../shared/types";
import {
  COMPLETE_TEXT,
  findChoiceGroups,
  isDistinguished,
  isEvalixNode,
  isVisible,
  labelOf,
  looksLikeNext,
  normalize,
  PROGRESS_TEXT,
  type ChoiceGroup,
} from "./infer";
import type { DomAdapter, Extraction, NextControl, OptionHandle } from "./types";

export { normalize };

const LETTERS = "ABCDEFGHIJ";
const HIGHLIGHT_ATTR = "data-evalix-highlight";
const NEXT_HIGHLIGHT_ATTR = "data-evalix-next";
const NAV_CONTROLS = 'button, input[type="submit"], input[type="button"], a, [role="button"]';

const meta = (doc: Document, name: string) =>
  doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content?.trim() ?? null;

/** Strips a leading "A." / "(B)" / "c)" label that some layouts render inside the option text. */
export const stripLetterPrefix = (s: string) => s.replace(/^\(?[A-Ja-j][.):]\s+/, "");

/** Navigation regions are never answer choices. */
const inNav = (el: Element) => el.closest("[data-qa-nav], nav") !== null;

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
    if (meta(doc, "evalix-page") === "complete" || doc.querySelector("[data-qa-complete]") !== null) return true;
    // No hint: a visible "assessment complete / your score" heading with no question on the page.
    const headings = [...doc.querySelectorAll("h1, h2, h3, [role='status'], [role='heading']")].filter(
      (h) => isVisible(h) && !isEvalixNode(h),
    );
    if (!headings.some((h) => COMPLETE_TEXT.test(normalize(h.textContent)))) return false;
    return doc.body ? findChoiceGroups(doc.body, inNav).length === 0 : true;
  }

  questionRoot(doc: Document): HTMLElement | null {
    const hinted = doc.querySelector<HTMLElement>("[data-qa-question]");
    if (hinted) return hinted;
    const group = this.singleGroup(doc.body);
    return group ? this.rootFor(group) : null;
  }

  extract(doc: Document): Extraction | null {
    const root = this.questionRoot(doc);
    if (!root) return null;
    const group = this.singleGroup(root);
    if (!group) return null;

    const options: OptionHandle[] = group.elements
      .slice(0, LETTERS.length)
      .map((element, i) => ({ id: LETTERS[i], kind: group.kind, element, group: group.elements }));
    const text = this.questionText(root, group);
    if (!text) return null;

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

  /** The page's one group of answer choices; null if there is none or it is ambiguous. */
  private singleGroup(scope: ParentNode | null): ChoiceGroup | null {
    if (!scope) return null;
    const groups = findChoiceGroups(scope, inNav);
    return groups.length === 1 ? groups[0] : null;
  }

  /** Climbs from the choices to the nearest ancestor that also holds the question's text. */
  private rootFor(group: ChoiceGroup): HTMLElement {
    let node: HTMLElement = group.container;
    for (let depth = 0; depth < 6 && node.parentElement; depth++) {
      if (this.questionText(node, group)) return node;
      node = node.parentElement;
    }
    return node;
  }

  optionText(o: OptionHandle): string {
    const raw = o.kind === "radio" ? labelOf(o.element) : normalize(o.element.textContent) || labelOf(o.element);
    return stripLetterPrefix(raw);
  }

  private questionText(root: HTMLElement, group: ChoiceGroup): string {
    const outside = (el: Element | null | undefined) =>
      !!el && isVisible(el) && !isEvalixNode(el) && !inNav(el) && !group.elements.some((o) => o.contains(el) || el.contains(o));
    const usable = (t: string) => t && !PROGRESS_TEXT.test(t) && !COMPLETE_TEXT.test(t);

    const labelledBy = group.container.getAttribute("aria-labelledby");
    const candidates = [
      root.querySelector("[data-qa-question-text]"),
      labelledBy ? root.ownerDocument.getElementById(labelledBy) : null,
      root.querySelector("legend"),
      group.kind === "select-option" && group.container.id
        ? root.querySelector(`label[for="${CSS.escape(group.container.id)}"]`)
        : null,
      ...root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, label"),
    ];
    for (const el of candidates) {
      if (!outside(el)) continue;
      const t = normalize(el!.textContent);
      if (usable(t)) return t;
    }
    // Unstructured markup: the longest visible text block in the question area that is not a choice.
    let best = "";
    for (const el of root.querySelectorAll<HTMLElement>("div, span, td, li")) {
      if (!outside(el) || el.querySelector("div, p, ul, ol, table, fieldset, select, button, input")) continue;
      const t = normalize(el.textContent);
      if (usable(t) && t.length > best.length && t.length <= 1000) best = t;
    }
    return best;
  }

  private progress(root: HTMLElement): { number: number; total: number } | null {
    // The "Question 3 of 15" marker may sit just outside the question area.
    for (let scope: HTMLElement | null = root, depth = 0; scope && depth < 4; scope = scope.parentElement, depth++) {
      for (const el of scope.querySelectorAll("p, span, div, h1, h2, h3, h4, small")) {
        const m = normalize(el.textContent).match(PROGRESS_TEXT);
        if (m) return { number: Number(m[1]), total: Number(m[2]) };
      }
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
    // click() on a radio input checks it and fires input/change; ARIA widgets and plain clickable
    // elements handle click themselves.
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
      case "toggle":
        return el.getAttribute("aria-pressed") === "true";
      case "generic":
        return isDistinguished(el, option.group ?? []);
    }
  }

  findNext(doc: Document): NextControl | null {
    const choices = this.extract(doc)?.options.map((o) => o.element) ?? [];
    const isChoice = (el: Element) => choices.some((c) => c === el || c.contains(el) || el.contains(c));
    const scopes: ParentNode[] = [
      ...doc.querySelectorAll("[data-qa-nav]"),
      this.questionRoot(doc)?.closest("form") ?? doc,
      doc,
    ];
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll<HTMLElement>(NAV_CONTROLS)) {
        if (!isVisible(el) || isEvalixNode(el) || !looksLikeNext(el)) continue;
        // An answer option that happens to say "next" is not navigation.
        if (isChoice(el) || (el.closest("[data-qa-question]") && !el.closest("[data-qa-nav]"))) continue;
        const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
        return { element: el, disabled, label: labelOf(el) };
      }
    }
    return null;
  }

  highlight(option: OptionHandle | null, root: HTMLElement, next: HTMLElement | null = null): void {
    const doc = root.ownerDocument;
    doc.querySelectorAll(`[${HIGHLIGHT_ATTR}], [${NEXT_HIGHLIGHT_ATTR}]`).forEach((el) => {
      el.removeAttribute(HIGHLIGHT_ATTR);
      el.removeAttribute(NEXT_HIGHLIGHT_ATTR);
      (el as HTMLElement).style.outline = "";
      (el as HTMLElement).style.outlineOffset = "";
    });
    if (!option) return;
    // Highlight the visible element (a radio's label, a select itself).
    const target =
      option.kind === "radio"
        ? ((option.element.closest("label") as HTMLElement | null) ?? option.element)
        : option.kind === "select-option"
          ? (option.element.closest("select") as HTMLElement)
          : option.element;
    target.setAttribute(HIGHLIGHT_ATTR, option.id);
    target.style.outline = "3px dashed #f59e0b";
    target.style.outlineOffset = "2px";
    if (next) {
      next.setAttribute(NEXT_HIGHLIGHT_ATTR, "");
      next.style.outline = "3px dotted #2563eb";
      next.style.outlineOffset = "3px";
    }
  }
}

function intAttr(el: Element, name: string): number | null {
  const v = el.getAttribute(name);
  const n = v == null ? NaN : parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}`;
}
