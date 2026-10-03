// Renders questions using the synthetic site's real layout code, so adapter tests run against
// exactly the markup the reference assessment produces.
import { LAYOUTS } from "../../../synthetic-site/js/layouts.js";

export type LayoutName = "radio" | "cards" | "select" | "listbox" | "toggle" | "tiles";
export type NavKind = "button" | "link" | "form" | "icon";
export const ALL_LAYOUTS: LayoutName[] = ["radio", "cards", "select", "listbox", "toggle", "tiles"];

export const SAMPLE = {
  id: "q07",
  text: "Which organ pumps blood through the human body?",
  options: [
    { id: "A", text: "Liver" },
    { id: "B", text: "Heart" },
    { id: "C", text: "Lungs" },
    { id: "D", text: "Kidney" },
  ],
};

// The only site CSS the agent depends on: unsemantic tiles look clickable (cursor: pointer).
const SITE_CSS = `.tile { cursor: pointer; } .toggle { cursor: pointer; }`;

export function setupPage(meta: Record<string, string> = { "evalix-qa": "enabled", "evalix-environment": "synthetic", "evalix-test-id": "quiz-15" }) {
  document.head.innerHTML =
    Object.entries(meta)
      .map(([name, content]) => `<meta name="${name}" content="${content}">`)
      .join("") + `<style>${SITE_CSS}</style>`;
  document.body.innerHTML = `<header><a href="index.html">Synthetic QA</a><h1>Assessment</h1></header><div id="stage"></div><p id="error" role="alert"></p><footer id="nav"></footer>`;
}

export function renderQuestion(
  layout: LayoutName,
  opts: { nav?: NavKind; number?: number; total?: number; withholdOptions?: boolean; q?: typeof SAMPLE; hooks?: boolean } = {},
) {
  const { nav = "button", number = 7, total = 15, withholdOptions = false, q = SAMPLE, hooks = true } = opts;
  const recorded: string[] = [];
  const { root, options, optionParent } = LAYOUTS[layout](q, (letter: string) => recorded.push(letter)) as {
    root: HTMLElement;
    options: HTMLElement[];
    optionParent?: HTMLElement;
  };

  const section = document.createElement("section");
  if (hooks) {
    section.setAttribute("data-qa-question", "");
    section.setAttribute("data-qa-question-id", q.id);
    section.setAttribute("data-qa-question-number", String(number));
    section.setAttribute("data-qa-question-total", String(total));
  }
  const progress = document.createElement("p");
  progress.textContent = `Question ${number} of ${total}`;
  section.append(progress, root);

  const parent = optionParent ?? root;
  const appendOptions = () => parent.append(...options);
  if (!withholdOptions) appendOptions();

  const navRow = document.createElement("div");
  if (hooks) navRow.setAttribute("data-qa-nav", "");
  if (nav === "button") navRow.innerHTML = `<button type="button" disabled>Next</button>`;
  if (nav === "link") navRow.innerHTML = `<a href="#" role="button">Continue →</a>`;
  if (nav === "form") navRow.innerHTML = `<input type="submit" value="Save &amp; next">`;
  if (nav === "icon") navRow.innerHTML = `<button type="button" title="Go on">⇨</button>`;

  const stage = document.getElementById("stage")!;
  if (nav === "form") {
    const form = document.createElement("form");
    form.append(section, navRow);
    stage.replaceChildren(form);
  } else {
    stage.replaceChildren(section);
    document.getElementById("nav")!.replaceChildren(navRow);
  }
  return { recorded, appendOptions, section };
}
