// Live run against a real AI provider. Skipped unless EVALIX_LIVE_PROVIDER is set, so the normal
// suite never spends API credits:
//   $env:EVALIX_LIVE_PROVIDER = "NVIDIA"; npx playwright test tests/live.spec.ts
// Hardest variant (no hooks, shuffled, every layout and Next variant):
//   $env:EVALIX_LIVE_PARAMS = "layout=all&nav=all&hooks=off&shuffle=on&delay=normal"
import { expect, readSession, startSession, test } from "./fixtures";

const provider = process.env.EVALIX_LIVE_PROVIDER;
const testId = process.env.EVALIX_LIVE_TEST ?? "quiz-15";
const params = process.env.EVALIX_LIVE_PARAMS ?? "layout=mixed&nav=mixed&delay=normal";

test.skip(!provider, "set EVALIX_LIVE_PROVIDER=MISTRAL|NVIDIA|AUTO to run");

test(`live ${provider} automation run on ${testId}`, async ({ context, popup }) => {
  test.setTimeout(15 * 60_000);
  const quiz = await context.newPage();
  await quiz.goto(`http://localhost:8080/quiz.html?test=${testId}&${params}`);
  await expect(quiz.locator(".question")).toBeVisible();

  expect(await startSession(popup, "http://localhost:8080/*", "automation", provider)).toEqual({ ok: true });
  await expect(quiz).toHaveURL(/complete\.html/, { timeout: 14 * 60_000 });
  await expect.poll(async () => (await readSession(popup))?.report, { timeout: 30_000 }).toBeTruthy();

  const { report, errorCount, actions } = await readSession(popup);
  const failed = actions.filter((a: any) => !a.ok);
  const recoveries = actions.filter((a: any) => a.step === "recovery").length;
  console.log(JSON.stringify({ provider, params, errorCount, recoveries, failed_actions: failed.length, ...report }, null, 2));
  for (const a of failed) console.log(`  ✗ Q${a.question ?? "-"} ${a.step}: ${a.detail ?? ""}`);
  expect(report.completion_rate).toBe(1);
});
