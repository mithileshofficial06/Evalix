// Synthetic assessment engine — the reference page Evalix is built and tested against.
//
// URL parameters:
//   test    = quiz-15 | quiz-50
//   layout  = mixed | all | radio | cards | select | listbox | toggle | tiles
//             (mixed rotates the first four; all rotates every layout)
//   nav     = mixed | all | button | link | form | icon   (all adds the unlabelled icon button)
//   delay   = normal | none | slow
//   hooks   = on | off    off: no data-qa-* attributes - the agent must infer everything
//   shuffle = off | on    on: options shown in a different order than their letters
import { el, LAYOUT_ALL, LAYOUT_ORDER, LAYOUTS } from "./layouts.js";

const params = new URLSearchParams(location.search);
const testId = params.get("test") || "quiz-15";
const layoutMode = params.get("layout") || "mixed";
const navMode = params.get("nav") || "mixed";
const delayProfile = params.get("delay") || "normal";
const hooks = params.get("hooks") !== "off";
const shuffle = params.get("shuffle") === "on";

const NAV_ORDER = ["button", "link", "form"];
const NAV_ALL = [...NAV_ORDER, "icon"];
const hook = (name, value = "") => (hooks ? { [name]: value } : {});
const DELAYS = { none: [0, 0], normal: [200, 900], slow: [1000, 2500] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () => {
  const [min, max] = DELAYS[delayProfile] ?? DELAYS.normal;
  return min + Math.random() * (max - min);
};

const stage = document.getElementById("stage");
const nav = document.getElementById("nav");
const answers = {};
let data;
let index = 0;
const startedAt = Date.now();

document.querySelector('meta[name="evalix-test-id"]').setAttribute("content", testId);

async function main() {
  stage.replaceChildren(spinner("Loading assessment…"));
  await sleep(randomDelay());
  const res = await fetch(`data/${testId}.json`);
  data = await res.json();
  document.getElementById("title").textContent = data.title;
  await renderQuestion(0);
}

function spinner(label) {
  return el("div", { className: "spinner", role: "status", text: label });
}

async function renderQuestion(i) {
  index = i;
  nav.replaceChildren();
  stage.replaceChildren(spinner("Loading question…"));
  await sleep(randomDelay());

  const q = data.questions[i];
  const total = data.questions.length;
  const layouts = layoutMode === "all" ? LAYOUT_ALL : LAYOUT_ORDER;
  const navs = navMode === "all" ? NAV_ALL : NAV_ORDER;
  const layoutName = layoutMode === "mixed" || layoutMode === "all" ? layouts[i % layouts.length] : layoutMode;
  const navName = navMode === "mixed" || navMode === "all" ? navs[i % navs.length] : navMode;

  let nextControl = null;
  // Shuffled: same letters (the page records the right answer) shown in another order.
  const shown = shuffle ? { ...q, options: i % 2 ? [...q.options].reverse() : [...q.options.slice(1), q.options[0]] } : q;
  const { root, options, optionParent } = LAYOUTS[layoutName](shown, (letter) => {
    answers[q.id] = letter;
    nextControl?.removeAttribute("disabled");
    setError("");
  });

  const question = el(
    "section",
    {
      className: "question",
      ...hook("data-qa-question"),
      ...hook("data-qa-question-id", q.id),
      ...hook("data-qa-question-number", String(i + 1)),
      ...hook("data-qa-question-total", String(total)),
      "data-layout": layoutName,
    },
    [el("p", { className: "progress", text: `Question ${i + 1} of ${total}` }), root],
  );

  // Every 7th question inserts its options late, after the stem is already visible,
  // to exercise "wait until the DOM is stable" logic.
  const parent = optionParent ?? root;
  const lateOptions = i % 7 === 3;
  if (!lateOptions) parent.append(...options);

  const isLast = i === total - 1;
  const { container, control } = buildNav(navName, isLast);
  nextControl = control;

  if (navName === "form") {
    const form = el("form", { id: "question-form" }, [question, container]);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      advance(q.id);
    });
    stage.replaceChildren(form);
  } else {
    stage.replaceChildren(question);
    nav.replaceChildren(container);
  }

  if (lateOptions) {
    await sleep(500);
    parent.append(...options);
  }
}

function buildNav(kind, isLast) {
  const label = isLast ? "Finish" : null;
  if (kind === "button") {
    // Plain button, disabled until an answer is chosen.
    const btn = el("button", { type: "button", className: "btn-next", disabled: "", text: label ?? "Next" });
    btn.addEventListener("click", () => advance(data.questions[index].id));
    return { container: el("div", { className: "nav-row", ...hook("data-qa-nav") }, [btn]), control: btn };
  }
  if (kind === "link") {
    // Anchor styled as a button; never disabled, validates on click instead.
    const a = el("a", { href: "#", role: "button", className: "link-next", text: label ?? "Continue →" });
    a.addEventListener("click", (e) => {
      e.preventDefault();
      advance(data.questions[index].id);
    });
    return { container: el("div", { className: "nav-row", ...hook("data-qa-nav") }, [a]), control: null };
  }
  if (kind === "icon") {
    // Icon-only button whose tooltip says nothing like "next": no text cue to go on.
    const btn = el("button", { type: "button", className: "btn-next btn-icon", title: "Go on", text: "⇨" });
    btn.addEventListener("click", () => advance(data.questions[index].id));
    return { container: el("div", { className: "nav-row", ...hook("data-qa-nav") }, [btn]), control: null };
  }
  // Form submit input.
  const submit = el("input", { type: "submit", className: "btn-next", value: isLast ? "Submit assessment" : "Save & next" });
  return { container: el("div", { className: "nav-row", ...hook("data-qa-nav") }, [submit]), control: null };
}

function setError(message) {
  document.getElementById("error").textContent = message;
}

function advance(questionId) {
  if (!answers[questionId]) {
    setError("Please choose an answer before continuing.");
    return;
  }
  if (index + 1 < data.questions.length) {
    renderQuestion(index + 1);
  } else {
    finish();
  }
}

function finish() {
  sessionStorage.setItem(
    "evalix-site-result",
    JSON.stringify({ test_id: testId, answers, started_at: startedAt, finished_at: Date.now() }),
  );
  location.href = `complete.html?test=${encodeURIComponent(testId)}`;
}

main().catch((err) => {
  stage.replaceChildren(el("p", { className: "error", text: `Failed to load: ${err.message}` }));
});
