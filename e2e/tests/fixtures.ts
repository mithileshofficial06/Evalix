// Launches Chromium with the built Evalix extension loaded.
import { BrowserContext, chromium, Page, test as base, Worker } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "extension", "dist");

export const test = base.extend<{ context: BrowserContext; worker: Worker; extensionId: string; popup: Page }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium", // new headless mode supports extensions
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
  popup: async ({ context, extensionId }, use) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await use(popup);
  },
});

export const expect = test.expect;

type Mode = "dry-run" | "automation";

/** Configures Evalix and starts a session on the tab currently showing `url`, via the popup page. */
export async function startSession(popup: Page, urlPattern: string, mode: Mode, provider = "MOCK") {
  return popup.evaluate(
    async ({ urlPattern, mode, provider }) => {
      await chrome.storage.local.set({
        settings: { enabled: true, mode, provider, backendUrl: "http://localhost:8000" },
        session: null,
      });
      const [tab] = await chrome.tabs.query({ url: urlPattern });
      return chrome.runtime.sendMessage({ type: "START_SESSION", tabId: tab.id });
    },
    { urlPattern, mode, provider },
  );
}

export async function readSession(popup: Page) {
  return popup.evaluate(async () => (await chrome.storage.local.get("session")).session as any);
}
