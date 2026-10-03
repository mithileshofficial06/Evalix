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

export function runQuiz(questions: QuizQuestion[], opts: { gapMs?: number; ignoreFirstClick?: boolean } = {}) {
  const { gapMs = 10, ignoreFirstClick = false } = opts;
  const answers: Record<string, string> = {};
  let index = 0;
  let clicksIgnored = 0;

  const show = (i: number) => {
    const q = questions[i];
    const { recorded } = renderQuestion(LAYOUTS[i % 4], { nav: NAVS[i % 3], number: i + 1, total: questions.length, q });
    const nav = document.querySelector<HTMLElement>("[data-qa-nav]")!;
    const control = nav.querySelector<HTMLElement>("button, a, input")!;
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
    const m = document.createElement("meta");
    m.name = "evalix-page";
    m.content = "complete";
    document.head.append(m);
    document.getElementById("stage")!.innerHTML = `<section data-qa-complete><h1>Assessment complete</h1></section>`;
  };

  show(0);
  return { answers };
}
