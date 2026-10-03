// A multi-question quiz flow in jsdom built from the site's real layouts: rotating layouts and
// Next variants, a loading gap between questions, and an in-page completion state.
import { LayoutName, NavKind, renderQuestion } from "./site";

const LAYOUTS: LayoutName[] = ["radio", "cards", "select", "listbox"];
const NAVS: NavKind[] = ["button", "link", "form"];

export interface QuizQuestion {
  id: string;
  text: string;
  options: { id: string; text: string }[];
  correct: string;
}

export function makeQuestions(n: number): QuizQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${String(i + 1).padStart(2, "0")}`,
    text: `Synthetic question number ${i + 1}?`,
    options: ["Alpha", "Bravo", "Charlie", "Delta"].map((t, j) => ({ id: "ABCD"[j], text: `${t} ${i + 1}` })),
    correct: "ABCD"[i % 4],
  }));
}

export interface QuizOptions {
  gapMs?: number;
  ignoreFirstClick?: boolean;
  layouts?: LayoutName[];
  navs?: NavKind[];
  hooks?: boolean;
  /** Show options in reverse order (the page still records the original letters). */
  shuffle?: boolean;
}

export function runQuiz(questions: QuizQuestion[], opts: QuizOptions = {}) {
  const { gapMs = 10, ignoreFirstClick = false, layouts = LAYOUTS, navs = NAVS, hooks = true, shuffle = false } = opts;
  const answers: Record<string, string> = {};
  let index = 0;
  let clicksIgnored = 0;

  const show = (i: number) => {
    const q = questions[i];
    const shown = shuffle ? { ...q, options: [...q.options].reverse() } : q;
    const { recorded } = renderQuestion(layouts[i % layouts.length], { nav: navs[i % navs.length], number: i + 1, total: questions.length, q: shown, hooks });
    const control = document.getElementById("stage")!.closest("body")!.querySelector<HTMLElement>("#nav button, #nav a, #nav input, form input[type=submit]")!;
    // Mirror the site: enable the button once an answer is chosen.
    const watch = setInterval(() => {
      if (recorded.length) {
        answers[q.id] = recorded.at(-1)!;
        control.removeAttribute("disabled");
      }
    }, 5);
    const go = (e: Event) => {
      e.preventDefault();
      if (!answers[q.id]) return;
      if (ignoreFirstClick && clicksIgnored === 0) {
        clicksIgnored++;
        return; // simulate a page that swallows the first click
      }
      clearInterval(watch);
      document.getElementById("stage")!.innerHTML = `<div role="status">Loading…</div>`;
      document.getElementById("nav")!.innerHTML = "";
      setTimeout(() => (++index < questions.length ? show(index) : complete()), gapMs);
    };
    const form = control.closest("form");
    if (form) form.addEventListener("submit", go);
    else control.addEventListener("click", go);
  };

  const complete = () => {
    if (hooks) {
      const m = document.createElement("meta");
      m.name = "evalix-page";
      m.content = "complete";
      document.head.append(m);
    }
    document.getElementById("stage")!.innerHTML = `<section${hooks ? " data-qa-complete" : ""}><h1>Assessment complete</h1><p>Your score is being calculated.</p></section>`;
  };

  show(0);
  return { answers };
}
