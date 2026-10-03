// The browser agent on the hardest synthetic variant: no data-qa-* hooks, options shuffled on
// screen, every layout (incl. unsemantic div tiles) and every Next variant (incl. an unlabelled
// icon button). Real extension + backend (MOCK provider) + site.
import { expect, readSession, startSession, test } from "./fixtures";

test("agent completes a hook-free, shuffled, all-layout assessment and reports its actions", async ({ context, popup }) => {
  const quiz = await context.newPage();
  await quiz.goto("http://localhost:8080/quiz.html?test=quiz-15&layout=all&nav=all&delay=normal&hooks=off&shuffle=on");
  await expect(quiz.locator(".question")).toBeVisible();
  await expect(quiz.locator("[data-qa-question]")).toHaveCount(0);

  expect(await startSession(popup, "http://localhost:8080/*", "automation")).toEqual({ ok: true });

  await expect(quiz).toHaveURL(/complete\.html/, { timeout: 90_000 });
  await expect(quiz.locator("#score")).toContainText("15 / 15"); // graded by the page itself

  await expect.poll(async () => (await readSession(popup))?.report?.correct, { timeout: 15_000 }).toBe(15);
  const session = await readSession(popup);
  expect(session.state).toBe("complete");
  expect(session.report).toMatchObject({ total_questions: 15, correct: 15, accuracy: 1, completion_rate: 1 });

  const steps = session.actions.map((a: any) => a.step);
  const verified = (step: string) => session.actions.filter((a: any) => a.step === step && a.ok).length;
  expect(verified("selection verified")).toBe(15);
  expect(verified("transition verified")).toBe(15);
  expect(steps).toContain("recovery"); // tiles ignore plain clicks
  expect(session.actions.some((a: any) => a.step === "AI recovery plan" && a.ok)).toBe(true); // unlabelled Next
  expect(steps.at(-1)).toBe("completion detected");
});
