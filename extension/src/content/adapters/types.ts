// A DomAdapter encapsulates everything page-specific. The automation engine only talks to this
// interface, so supporting another assessment system you administer means writing a new adapter.
import type { ExtractedQuestion, PageInfo } from "../../shared/types";

export type OptionKind = "radio" | "aria-radio" | "select-option" | "aria-option";

export interface OptionHandle {
  id: string; // letter assigned in DOM order
  kind: OptionKind;
  element: HTMLElement;
}

export interface Extraction {
  question: ExtractedQuestion;
  root: HTMLElement;
  options: OptionHandle[];
}

export interface NextControl {
  element: HTMLElement;
  disabled: boolean;
  label: string;
}

export interface DomAdapter {
  readonly name: string;
  /** Returns page info if this page has opted in to Evalix, else null. */
  detect(doc: Document): PageInfo | null;
  /** True when the assessment has finished (completion page/state). */
  isComplete(doc: Document): boolean;
  /** The element containing the current question, if one is rendered. */
  questionRoot(doc: Document): HTMLElement | null;
  /** Extracts the current question; null if not (yet) fully rendered. */
  extract(doc: Document): Extraction | null;
  /** Selects an option in a way that fires the page's own event handlers. */
  select(option: OptionHandle): void;
  /** Whether the given option is currently selected according to the DOM. */
  isSelected(option: OptionHandle): boolean;
  /** Finds the control that advances to the next question / finishes. */
  findNext(doc: Document): NextControl | null;
  /** Visually marks an option (dry-run). */
  highlight(option: OptionHandle | null, root: HTMLElement): void;
}
