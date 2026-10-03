// Adversarial validation runs (long; MOCK provider unless noted). Skipped unless EVALIX_VALIDATION=1:
//   $env:EVALIX_VALIDATION = "1"; npx playwright test tests/validation.spec.ts
// Each scenario prints one "VALIDATION {json}" line with the run's metrics.
import type { Page } from "@playwright/test";
import { expect, readSession, startSession, test } from "./fixtures";

test.skip(!process.env.EVALIX_VALIDATION, "set EVALIX_VALIDATION=1 to run");

const ADVERSARIAL = "layout=all&nav=all&hooks=off&shuffle=on&delay=slow&ids=dynamic";
const QUIZ = "http://localhost:8080/*";

function metrics(name: string, s: any, wallMs: number) {
  const a: any[] = s.actions ?? [];
  const r = s.report ?? {};
  const answered = s.results.filter((x: any) => x.answer);
  const line = {
    name,
    state: s.state,
    completion_rate: r.completion_rate ?? null,
    correct: r.correct != null ? `${r.correct}/${r.total_questions}` : null,
    accuracy: r.accuracy ?? null,
    total_time_s: Math.round((r.total_duration_ms ?? wallMs) / 100) / 10,
    avg_ai_ms: r.avg_api_latency_ms != null ? Math.round(r.avg_api_latency_ms) : null,
    questions_processed: s.results.length,
    actions: a.length,
    failed_actions: a.filter((x) => !x.ok).length,
    recoveries: a.filter((x) => x.step === "recovery").length,
    ai_page_readings: a.filter((x) => x.step === "page sent to AI").length,
    ai_recovery_plans: a.filter((x) => x.step === "AI recovery plan" && x.ok).length,
    vision_used: a.filter((x) => x.step === "page sent to AI" && x.detail?.includes("screenshot")).length,
    providers: [...new Set(answered.map((x: any) => x.provider))],
    fallback_logs: (s.logs ?? []).filter((l: any) => l.message.includes("(fallback)")).length,
    failed_steps: [...new Set(a.filter((x) => !x.ok).map((x) => `${x.step}: ${x.detail ?? ""}`))].slice(0, 8),
  };
  console.log(`VALIDATION ${JSON.stringify(line)}`);
  return line;
}

async function open(context: any, params: string, testId = "quiz-15"): Promise<Page> {
  const quiz = await context.newPage();
  await quiz.goto(`http://localhost:8080/quiz.html?test=${testId}&${params}`);
  await expect(quiz.locator(".question")).toBeVisible({ timeout: 15_000 });
  return quiz;
}

async function fullRun(name: string, context: any, popup: Page, params: string, testId: string, count: number) {
  const quiz = await open(context, params, testId);
  // Dynamic ids really change on every render.
  const firstId = await quiz.locator(".question").getAttribute("id");
  const t0 = Date.now();
  expect(await startSession(popup, QUIZ, "automation")).toEqual({ ok: true });
  await expect(quiz).toHaveURL(/complete\.html/, { timeout: count * 8000 });
  await expect(quiz.locator("#score")).toContainText(`${count} / ${count}`); // the page's own grading
  await expect.poll(async () => (await readSession(popup))?.report?.correct, { timeout: 20_000 }).toBe(count);
  const s = await readSession(popup);
  const m = metrics(name, s, Date.now() - t0);
  expect(s.state).toBe("complete");
  expect(m.completion_rate).toBe(1);
  if (params.includes("ids=dynamic")) expect(firstId).toMatch(/^x[a-z0-9]+$/);
  return { s, m };
}

test("A. 15 questions — all layouts, hooks off, shuffled, all Next types, slow rendering, dynamic ids", async ({ context, popup }) => {
  test.setTimeout(5 * 60_000);
  const { m } = await fullRun("A adversarial quiz-15", context, popup, ADVERSARIAL, "quiz-15", 15);
  expect(m.recoveries).toBeGreaterThan(0); // tiles ignore plain clicks
});

test("B. 50 questions — same adversarial conditions", async ({ context, popup }) => {
  test.setTimeout(12 * 60_000);
  await fullRun("B adversarial quiz-50", context, popup, ADVERSARIAL, "quiz-50", 50);
});

test("C. failed-click recovery — unsemantic tiles that ignore click()", async ({ context, popup }) => {
  test.setTimeout(5 * 60_000);
  const { s } = await fullRun("C tiles only", context, popup, "layout=tiles&nav=button&hooks=off&shuffle=on&delay=none&ids=dynamic", "quiz-15", 15);
  const a: any[] = s.actions;
  // Every question: plain click failed verification, then recovered with pointer events.
  expect(a.filter((x) => x.step === "option clicked" && x.detail === "pointer events")).toHaveLength(15);
  expect(a.filter((x) => x.step === "selection verified" && x.ok)).toHaveLength(15);
});

test("D. page-transition recovery — Next swallows the first press on every question", async ({ context, popup }) => {
  test.setTimeout(8 * 60_000);
  const { s } = await fullRun("D flaky Next", context, popup, `${ADVERSARIAL.replace("delay=slow", "delay=none")}&flaky=on`, "quiz-15", 15);
  const a: any[] = s.actions;
  expect(a.filter((x) => x.step === "transition verified" && !x.ok).length).toBeGreaterThanOrEqual(14);
  expect(a.filter((x) => x.step === "transition verified" && x.ok)).toHaveLength(15);
});

test("E. dry run — highlights targets, never interacts, follows manual advance", async ({ context, popup }) => {
  test.setTimeout(3 * 60_000);
  const quiz = await open(context, ADVERSARIAL.replace("delay=slow", "delay=none"));
  const t0 = Date.now();
  expect(await startSession(popup, QUIZ, "dry-run")).toEqual({ ok: true });

  await expect(quiz.locator("[data-evalix-highlight]")).toBeVisible({ timeout: 15_000 });
  await expect(quiz.locator("[data-evalix-next]")).toBeVisible();
  await expect(quiz.locator("evalix-overlay")).toHaveCount(1);
  await quiz.waitForTimeout(2000);
  await expect(quiz.locator('input[type="radio"]:checked')).toHaveCount(0); // Q1 is the radio layout
  await expect(quiz.locator(".progress")).toHaveText("Question 1 of 15");

  // A human follows the suggestion and advances; the agent suggests for the new layout.
  await quiz.locator("[data-evalix-highlight]").click();
  await quiz.locator("[data-evalix-next]").click();
  await expect.poll(async () => (await readSession(popup)).results.length, { timeout: 15_000 }).toBe(2);
  await expect(quiz.locator(".progress")).toHaveText("Question 2 of 15");
  await expect(quiz.locator('[role="radio"][aria-checked="true"]')).toHaveCount(0); // Q2 cards untouched

  const s = await readSession(popup);
  metrics("E dry run (2 questions)", s, Date.now() - t0);
  expect(s.state).toBe("reviewing");
  expect(s.results.every((r: any) => r.selected === false && r.answer)).toBe(true);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "STOP_SESSION" }));
  await expect(quiz.locator("evalix-overlay")).toHaveCount(0);
  await expect(quiz.locator("[data-evalix-highlight]")).toHaveCount(0);
});

test("F. STOP during an active adversarial run", async ({ context, popup }) => {
  test.setTimeout(3 * 60_000);
  const quiz = await open(context, ADVERSARIAL, "quiz-50");
  const t0 = Date.now();
  expect(await startSession(popup, QUIZ, "automation")).toEqual({ ok: true });
  await expect.poll(async () => (await readSession(popup)).results.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);

  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "STOP_SESSION" }));
  const stoppedAt = await quiz.locator(".progress").textContent();
  const resultsAtStop = (await readSession(popup)).results.length;
  await quiz.waitForTimeout(6000);
  const s = await readSession(popup);
  metrics("F stop mid-run", s, Date.now() - t0);
  expect(s.state).toBe("stopped");
  const n = (t: string | null) => Number(t?.match(/\d+/)?.[0]);
  expect(n(await quiz.locator(".progress").textContent()) - n(stoppedAt)).toBeLessThanOrEqual(1); // at most the in-flight step
  expect(s.results.length - resultsAtStop).toBeLessThanOrEqual(1);
  await expect(quiz.locator("evalix-overlay")).toHaveCount(0);
});

// Live provider fallback (costs a few NVIDIA calls). Run with an invalid Mistral key:
//   $env:EVALIX_FALLBACK = "1"; $env:MISTRAL_API_KEY = "invalid"
test("G. AUTO falls back to NVIDIA when Mistral fails (live, 3 questions)", async ({ context, popup }) => {
  test.skip(!process.env.EVALIX_FALLBACK, "set EVALIX_FALLBACK=1 and MISTRAL_API_KEY=invalid");
  test.setTimeout(4 * 60_000);
  const quiz = await open(context, ADVERSARIAL.replace("delay=slow", "delay=none"));
  const t0 = Date.now();
  expect(await startSession(popup, QUIZ, "automation", "AUTO")).toEqual({ ok: true });
  await expect.poll(async () => (await readSession(popup)).results.length, { timeout: 180_000 }).toBeGreaterThanOrEqual(3);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "STOP_SESSION" }));
  await expect.poll(async () => (await readSession(popup)).state, { timeout: 10_000 }).toBe("stopped");
  const s = await readSession(popup);
  const m = metrics("G AUTO fallback (live)", s, Date.now() - t0);
  expect(m.providers).toEqual(["NVIDIA"]);
  expect(m.fallback_logs).toBeGreaterThanOrEqual(3);
  expect(s.results.slice(0, 3).every((r: any) => r.selected && !r.error)).toBe(true);
  void quiz;
});

// Screenshot capture inside the real extension (no AI call).
test("H. extension can capture the assessment tab for vision fallback", async ({ context, popup }) => {
  const quiz = await open(context, "layout=tiles&hooks=off&delay=none");
  await quiz.bringToFront();
  const result = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "http://localhost:8080/*" });
    try {
      const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
      return { ok: true, prefix: shot.slice(0, 23), bytes: shot.length };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  console.log(`VALIDATION ${JSON.stringify({ name: "H screenshot capture", ...result })}`);
});
