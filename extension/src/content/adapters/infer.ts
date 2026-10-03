// Semantic inference over an arbitrary question layout: which elements are the answer choices,
// whether one is selected, and which control advances — judged by what elements *are* (native
// inputs, ARIA roles, labels, visual grouping), never by fixed selectors, ids or positions.
import type { OptionKind } from "./types";

export const normalize = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Words and glyphs that mean "go forward" on a navigation control. */
export const NEXT_TEXT = /\b(next|continue|finish|submit|proceed|advance)\b|[→›»]/i;
export const PROGRESS_TEXT = /^\s*question\s+(\d+)\s+(?:of|\/)\s+(\d+)\s*$/i;
export const COMPLETE_TEXT = /\bassessment (?:is )?(?:complete|completed|submitted|finished)\b|\bthank you for (?:completing|taking)\b|\byour (?:final )?score\b/i;

/** Evalix's own overlay lives in a shadow root under this tag and is never part of the page model. */
export const OVERLAY_TAG = "evalix-overlay";

export function isEvalixNode(el: Element): boolean {
  return el.closest(OVERLAY_TAG) !== null;
}

/** Visible to a user: not hidden by attribute, ARIA or CSS (layout-free so it also works in jsdom). */
export function isVisible(el: Element): boolean {
  if (el.closest("[hidden], [aria-hidden='true'], template, script, style, noscript")) return false;
  const view = el.ownerDocument.defaultView;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = view?.getComputedStyle(n);
    if (cs && (cs.display === "none" || cs.visibility === "hidden")) return false;
  }
  return true;
}

function cursorIsPointer(el: Element): boolean {
  try {
    return el.ownerDocument.defaultView?.getComputedStyle(el).cursor === "pointer";
  } catch {
    return false;
  }
}

/** The text a user sees for a control (its label, content, or accessible name). */
export function labelOf(el: Element): string {
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
    const doc = el.ownerDocument;
    const byFor = el.id ? doc.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const label = byFor ?? el.closest("label");
    if (label) return normalize(label.textContent);
    return normalize(el.getAttribute("aria-label") ?? el.value);
  }
  if (el instanceof HTMLInputElement) {
    return normalize([el.value, el.getAttribute("aria-label"), el.title].filter(Boolean).join(" "));
  }
  const text = normalize(el.textContent);
  const extra = [el.getAttribute("aria-label"), el.getAttribute("title")].filter(Boolean).join(" ");
  return normalize(text && extra && !text.includes(extra) ? `${text} ${extra}` : text || extra);
}

/** True for controls that read as navigation (Next / Continue / Submit …). */
export function looksLikeNext(el: Element): boolean {
  return NEXT_TEXT.test(labelOf(el));
}

// ---- Selection state ---------------------------------------------------------------------------

/** State markers that typically distinguish the selected choice from its siblings. */
function stateTokens(el: Element): Set<string> {
  const tokens = new Set<string>();
  for (const c of el.classList) tokens.add(`.${c}`);
  for (const a of ["aria-checked", "aria-selected", "aria-pressed", "aria-current", "data-state", "data-selected", "data-checked"]) {
    const v = el.getAttribute(a);
    if (v != null) tokens.add(`${a}=${v}`);
  }
  if (el.querySelector("input:checked")) tokens.add(":checked-inside");
  return tokens;
}

/**
 * Generic selection check for choices without native/ARIA state: the element is selected when it
 * carries a state marker (class or attribute value) that none of its sibling choices has.
 */
export function isDistinguished(el: Element, siblings: Element[]): boolean {
  const mine = stateTokens(el);
  const others = siblings.filter((s) => s !== el).map(stateTokens);
  if (!others.length) return false;
  for (const t of mine) {
    if (/(=false|=off|=unchecked)$/.test(t)) continue;
    if (others.every((o) => !o.has(t))) return true;
  }
  return false;
}

// ---- Answer-choice groups ----------------------------------------------------------------------

export interface ChoiceGroup {
  kind: OptionKind;
  elements: HTMLElement[];
  /** The element that holds all choices (radiogroup, listbox, select, fieldset or common parent). */
  container: HTMLElement;
}

function commonAncestor(els: Element[]): HTMLElement {
  let node: HTMLElement | null = els[0].parentElement;
  while (node && !els.every((e) => node!.contains(e))) node = node.parentElement;
  return node ?? (els[0].ownerDocument.body as HTMLElement);
}

function groupBy(els: HTMLElement[], key: (el: HTMLElement) => unknown): HTMLElement[][] {
  const map = new Map<unknown, HTMLElement[]>();
  for (const el of els) {
    const k = key(el);
    map.set(k, [...(map.get(k) ?? []), el]);
  }
  return [...map.values()];
}

const usable = (el: Element) => isVisible(el) && !isEvalixNode(el);

/**
 * Finds groups of answer choices in `scope`, strongest evidence first: native radios, ARIA radios,
 * <select>, ARIA listbox options, toggle buttons, then visually grouped clickable siblings.
 * Returns the groups of the first kind of evidence that yields any.
 */
export function findChoiceGroups(scope: ParentNode, exclude: (el: Element) => boolean = () => false): ChoiceGroup[] {
  const pick = (selector: string) =>
    [...scope.querySelectorAll<HTMLElement>(selector)].filter((el) => usable(el) && !exclude(el));

  const strategies: [OptionKind, () => HTMLElement[][]][] = [
    ["radio", () => groupBy(pick('input[type="radio"]'), (el) => (el as HTMLInputElement).name || el.closest("fieldset, form") || el.parentElement)],
    ["aria-radio", () => groupBy(pick('[role="radio"]'), (el) => el.closest('[role="radiogroup"]') ?? el.parentElement)],
    [
      "select-option",
      () =>
        pick("select")
          .filter((s) => !(s as HTMLSelectElement).multiple)
          .map((s) => [...(s as HTMLSelectElement).options].filter((o) => o.value !== "" && !o.disabled) as HTMLElement[]),
    ],
    ["aria-option", () => groupBy(pick('[role="option"]'), (el) => el.closest('[role="listbox"]') ?? el.parentElement)],
    ["toggle", () => groupBy(pick("button[aria-pressed], [role='button'][aria-pressed]"), (el) => el.parentElement).filter((g) => !g.some(looksLikeNext))],
    ["generic", () => genericChoiceGroups(scope, exclude)],
  ];

  for (const [kind, find] of strategies) {
    const groups = find().filter((g) => g.length >= 2);
    if (groups.length) {
      return groups.map((elements) => ({
        kind,
        elements,
        container: kind === "select-option" ? (elements[0].closest("select") as HTMLElement) : commonAncestor(elements),
      }));
    }
  }
  return [];
}

const CLICKABLE = 'button, [role="button"], [onclick], [tabindex]:not([tabindex="-1"]), li, div, span, label';

/**
 * Choices with no semantics at all (e.g. clickable <div> tiles): sibling elements that share tag and
 * classes, look clickable, carry short text and are not navigation.
 */
function genericChoiceGroups(scope: ParentNode, exclude: (el: Element) => boolean): HTMLElement[][] {
  const candidates = [...scope.querySelectorAll<HTMLElement>(CLICKABLE)].filter((el) => {
    if (!usable(el) || exclude(el)) return false;
    const text = normalize(el.textContent);
    if (!text || text.length > 200 || looksLikeNext(el)) return false;
    if (el.closest("a[href], nav, header, footer")) return false;
    return el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.hasAttribute("onclick") || el.hasAttribute("tabindex") || cursorIsPointer(el);
  });
  // `cursor` is inherited, so a tile's inner spans look clickable too: keep only the outermost.
  const set = new Set(candidates);
  const outermost = candidates.filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
    return true;
  });
  const signature = (el: HTMLElement) => `${el.tagName}.${[...el.classList].filter((c) => !/selected|active|checked|chosen|current/i.test(c)).sort().join(".")}`;
  return groupBy(outermost, (el) => el.parentElement)
    .flatMap((siblings) => groupBy(siblings, signature))
    .filter((g) => g.length >= 2 && g.length <= 10);
}

/** Option kind of an element named by the AI (used when the heuristics could not read the page). */
export function kindOf(el: HTMLElement): OptionKind {
  if (el instanceof HTMLInputElement && el.type === "radio") return "radio";
  if (el instanceof HTMLOptionElement) return "select-option";
  const role = el.getAttribute("role");
  if (role === "radio") return "aria-radio";
  if (role === "option") return "aria-option";
  if (el.hasAttribute("aria-pressed")) return "toggle";
  return "generic";
}
