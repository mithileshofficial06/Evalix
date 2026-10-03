// Verifies the synthetic assessment itself works when driven by a "human" (Playwright, no extension):
// every layout and Next-button variant, late-loading options, validation, and the completion page.
import { expect, Page, test } from "@playwright/test";

async function answerCurrent(page: Page) {
  const q = page.locator("[data-qa-question]");
  await expect(q).toBeVisible();
  const layout = await q.getAttribute("data-layout");
  // Options may be inserted late; wait for them.
  if (layout === "radio") {
    await q.locator('input[type="radio"]').first().check();
  } else if (layout === "cards") {
    await q.getByRole("radio").first().click();
  } else if (layout === "select") {
    await expect(q.locator("select option")).toHaveCount(5);
    await q.locator("select").selectOption({ index: 1 });
  } else if (layout === "listbox") {
    await q.getByRole("option").first().click();
  } else {
    throw new Error(`Unknown layout ${layout}`);
  }
}

async function clickNext(page: Page) {
  await page.locator("[data-qa-nav]").locator("button, a, input[type=submit]").first().click();
}

test("15-question mixed assessment can be completed manually", async ({ page }) => {
  await page.goto("/quiz.html?test=quiz-15&layout=mixed&nav=mixed&delay=none");
  await expect(page.locator('meta[name="evalix-test-id"]')).toHaveAttribute("content", "quiz-15");

  for (let i = 1; i <= 15; i++) {
    await expect(page.locator("[data-qa-question]")).toHaveAttribute("data-qa-question-number", String(i));
    await answerCurrent(page);
    await clickNext(page);
  }

  await expect(page).toHaveURL(/complete\.html/);
  await expect(page.locator("[data-qa-complete]")).toBeVisible();
  await expect(page.locator("#summary")).toContainText("Recorded 15 answers");
});

test("advancing without an answer is blocked", async ({ page }) => {
  await page.goto("/quiz.html?test=quiz-15&layout=radio&nav=link&delay=none");
  await expect(page.locator("[data-qa-question]")).toBeVisible();
  await clickNext(page);
  await expect(page.locator("#error")).toContainText("Please choose an answer");
  await expect(page.locator("[data-qa-question]")).toHaveAttribute("data-qa-question-number", "1");
});

test("button variant is disabled until answered", async ({ page }) => {
  await page.goto("/quiz.html?test=quiz-15&layout=listbox&nav=button&delay=none");
  const next = page.locator("[data-qa-nav] button");
  await expect(next).toBeDisabled();
  await answerCurrent(page);
  await expect(next).toBeEnabled();
});
