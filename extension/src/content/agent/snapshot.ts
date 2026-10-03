// OBSERVE: a compact, model-readable description of what is on the page right now.
//
// Each interactive element gets an id ("e12") that is only valid for this observation; the ids map
// back to elements through an in-memory registry, so the page's DOM is never modified and the AI
// can only ever refer to elements that were actually observed.
import type { PageSnapshot, SnapshotElement } from "../../shared/types";
import { isEvalixNode, isVisible, labelOf, normalize } from "../adapters/infer";

const MAX_ELEMENTS = 200;
const MAX_TEXTS = 60;

const INTERACTIVE = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "option",
  "textarea",
  "[role='button']",
  "[role='link']",
  "[role='radio']",
  "[role='checkbox']",
  "[role='option']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='switch']",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export interface Observation {
  snapshot: PageSnapshot;
  registry: Map<string, HTMLElement>;
}

function roleOf(el: HTMLElement): string {
  const role = el.getAttribute("role");
  if (role) return el.hasAttribute("aria-pressed") && role === "button" ? "toggle" : role;
  if (el instanceof HTMLInputElement) {
    if (el.type === "radio" || el.type === "checkbox") return el.type;
    if (el.type === "submit" || el.type === "button") return "submit";
    return "textbox";
  }
  if (el instanceof HTMLButtonElement) return el.hasAttribute("aria-pressed") ? "toggle" : el.type === "submit" ? "submit" : "button";
  if (el instanceof HTMLAnchorElement) return "link";
  if (el instanceof HTMLSelectElement) return "combobox";
  if (el instanceof HTMLOptionElement) return "option";
  if (el instanceof HTMLTextAreaElement) return "textbox";
  return "clickable";
}

function stateOf(el: HTMLElement): string[] {
  const s: string[] = [];
  if ((el as HTMLInputElement).checked || el.getAttribute("aria-checked") === "true") s.push("checked");
  if ((el as HTMLOptionElement).selected && el instanceof HTMLOptionElement && el.value !== "") s.push("selected");
  if (el.getAttribute("aria-selected") === "true") s.push("selected");
  if (el.getAttribute("aria-pressed") === "true") s.push("pressed");
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") s.push("disabled");
  if ([...el.classList].some((c) => /^(is-)?(selected|active|checked|chosen)$/i.test(c))) s.push("highlighted");
  return s;
}

/** Elements that act together (radios by name, options in one list, siblings in one container). */
function groupKeyOf(el: HTMLElement, keys: Map<Element, string>): string | null {
  const anchor =
    (el instanceof HTMLInputElement && el.type === "radio" && el.name ? el.form ?? el.ownerDocument.body : null) ??
    el.closest("select, [role='radiogroup'], [role='listbox'], [role='group'], fieldset") ??
    el.parentElement;
  if (!anchor) return null;
  const extra = el instanceof HTMLInputElement && el.type === "radio" && el.name ? `:${el.name}` : "";
  const base = keys.get(anchor) ?? `g${keys.size + 1}`;
  keys.set(anchor, base);
  return base + extra;
}

/** Outermost clickable only: a tile's inner spans inherit `cursor: pointer` and add nothing. */
function isPointerTile(el: HTMLElement): boolean {
  try {
    const view = el.ownerDocument.defaultView;
    if (view?.getComputedStyle(el).cursor !== "pointer") return false;
    const parent = el.parentElement;
    return !parent || view.getComputedStyle(parent).cursor !== "pointer";
  } catch {
    return false;
  }
}

export function observePage(doc: Document): Observation {
  const registry = new Map<string, HTMLElement>();
  const groupKeys = new Map<Element, string>();
  const elements: SnapshotElement[] = [];
  const seen = new Set<Element>();

  const candidates = [...doc.querySelectorAll<HTMLElement>(INTERACTIVE)];
  // Clickable elements with no semantics at all (styled divs) — found through their cursor.
  for (const el of doc.querySelectorAll<HTMLElement>("div, li, span, label, td")) {
    if (!el.matches(INTERACTIVE) && isPointerTile(el) && normalize(el.textContent).length <= 200) candidates.push(el);
  }
  // Document order, so ids follow what the user sees top to bottom.
  candidates.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  for (const el of candidates) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (seen.has(el) || isEvalixNode(el)) continue;
    // Options of a <select> are visible through their select even though they are not rendered.
    if (!(el instanceof HTMLOptionElement ? isVisible(el.closest("select") ?? el) : isVisible(el))) continue;
    if (el instanceof HTMLOptionElement && el.value === "") continue; // placeholder
    // A radio inside a <label> is reported once, as the radio, with the label's text.
    if (el.tagName === "LABEL" && el.querySelector("input")) continue;
    seen.add(el);
    const id = `e${elements.length + 1}`;
    registry.set(id, el);
    elements.push({
      id,
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      text: labelOf(el).slice(0, 300),
      state: stateOf(el),
      group: groupKeyOf(el, groupKeys),
    });
  }

  return {
    snapshot: {
      url: doc.location?.href ?? "",
      title: normalize(doc.title).slice(0, 300),
      texts: visibleTexts(doc),
      elements,
    },
    registry,
  };
}

/** Visible text blocks (headings, paragraphs, labels, short leaf blocks) in document order. */
function visibleTexts(doc: Document): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const el of doc.body?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, p, legend, label, li, td, div, span, [role='alert'], [role='status']") ?? []) {
    if (out.length >= MAX_TEXTS) break;
    if (isEvalixNode(el) || !isVisible(el)) continue;
    // Leaf-ish blocks only, so a container's text is not repeated for each of its children.
    if (el.querySelector("p, div, li, h1, h2, h3, h4, h5, h6, legend, fieldset, ul, ol, table")) continue;
    const t = normalize(el.textContent).slice(0, 500);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Cheap fingerprint of what the page shows, to avoid asking the AI twice about the same page. */
export function pageFingerprint(doc: Document): string {
  const text = normalize(doc.body?.textContent).slice(0, 4000);
  const controls = doc.querySelectorAll("input, button, select, [role]").length;
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `${controls}:${(h >>> 0).toString(36)}`;
}
