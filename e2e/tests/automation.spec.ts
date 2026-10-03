// Full loop: real extension + real backend (MOCK provider, 100% accuracy) + synthetic site.
import { expect, readSession, startSession, test } from "./fixtures";

const QUIZ_URL = "http://localhost:8080/*";

for (const { test: testId, delay, count } of [
  { test: "quiz-15", delay: "normal", count: 15 },
  { test: "quiz-50", delay: "none", count: 50 },
]) {
  test(`automation completes ${testId} (${delay} delays) and grades 100%`, async ({ context, popup }) => {
    const quiz = await context.newPage();
    await quiz.goto(`http://localhost:8080/quiz.html?test=${testId}&layout=mixed&nav=mixed&delay=${delay}`);
    await expect(quiz.locator("[data-qa-question]")).toBeVisible();

    expect(await startSession(popup, QUIZ_URL, "automation")).toEqual({ ok: true });

    // The extension drives the page all the way to the completion page.
    await expect(quiz).toHaveURL(/complete\.html/, { timeout: count * 3000 });
    await expect(quiz.locator("#score")).toContainText(`${count} / ${count}`);

    // The session is graded by the backend simulator.
    await expect.poll(async () => (await readSession(popup))?.report?.completion_rate, { timeout: 15_000 }).toBe(1);
    const session = await readSession(popup);
    expect(session.state).toBe("complete");
    expect(session.results).toHaveLength(count);
    expect(session.errorCount).toBe(0);
    expect(session.report).toMatchObject({ total_questions: count, correct: count, accuracy: 1, unanswered: 0 });
  });
}

test("dry-run highlights a suggestion but never selects or advances", async ({ context, popup }) => {
  const quiz = await context.newPage();
  await quiz.goto("http://localhost:8080/quiz.html?test=quiz-15&layout=radio&nav=button&delay=none");
  await expect(quiz.locator("[data-qa-question]")).toBeVisible();

  expect(await startSession(popup, QUIZ_URL, "dry-run")).toEqual({ ok: true });

  await expect(quiz.locator("[data-evalix-highlight]")).toBeVisible();
  await quiz.waitForTimeout(1500);
  await expect(quiz.locator("[data-qa-question]")).toHaveAttribute("data-qa-question-number", "1");
  await expect(quiz.locator('input[type="radio"]:checked')).toHaveCount(0);
  await expect(quiz.locator("[data-qa-nav] button")).toBeDisabled();

  const session = await readSession(popup);
  expect(session.state).toBe("reviewing");
  expect(session.results).toHaveLength(1);
  expect(session.results[0].selected).toBe(false);

  // A human advancing the page gets a new suggestion.
  await quiz.locator('input[type="radio"]').first().check();
  await quiz.locator("[data-qa-nav] button").click();
  await expect.poll(async () => (await readSession(popup)).results.length).toBe(2);
});

test("refuses pages that have not opted in", async ({ context, popup }) => {
  const page = await context.newPage();
  await page.goto("http://localhost:8080/index.html"); // no evalix-qa meta
  const reply = await startSession(popup, "http://localhost:8080/index.html", "dry-run");
  expect(reply).toMatchObject({ ok: false, error: expect.stringMatching(/not an Evalix-enabled/) });
});

test("stop halts automation mid-run", async ({ context, popup }) => {
  const quiz = await context.newPage();
  await quiz.goto("http://localhost:8080/quiz.html?test=quiz-50&layout=mixed&nav=mixed&delay=slow");
  await expect(quiz.locator("[data-qa-question]")).toBeVisible();
  expect(await startSession(popup, QUIZ_URL, "automation")).toEqual({ ok: true });

  await expect.poll(async () => (await readSession(popup)).results.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "STOP_SESSION" }));
  const stoppedAt = Number(await quiz.locator("[data-qa-question]").getAttribute("data-qa-question-number"));

  await quiz.waitForTimeout(4000);
  const session = await readSession(popup);
  expect(session.state).toBe("stopped");
  const nowAt = Number(await quiz.locator("[data-qa-question]").getAttribute("data-qa-question-number").catch(() => stoppedAt));
  expect(nowAt - stoppedAt).toBeLessThanOrEqual(1); // at most the in-flight transition completes
});
