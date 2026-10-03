// Background service worker: owns settings and session state and is the only
// component that talks to the local backend.
import type { BackgroundMessage, ContentMessage, PopupMessage, ProbeReply } from "../shared/messages";
import { getSettings, getStore, setBackendStatus, updateSettings } from "../shared/storage";
import type { BackendStatus, Settings } from "../shared/types";
import { api } from "./api";
import { handleContentMessage, isActive, startSession, stopSession } from "./session";

chrome.runtime.onInstalled.addListener(async () => {
  // Persist defaults so the popup and content scripts read a complete settings object.
  await updateSettings({});
  await checkBackend();
});

chrome.runtime.onMessage.addListener((msg: PopupMessage | ContentMessage, sender, sendResponse) => {
  // Extension pages (popup, even when opened in a tab) have a chrome-extension:// URL;
  // content scripts report the web page's URL.
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL("")) ?? false;
  const work = fromExtensionPage ? handlePopup(msg as PopupMessage) : handleContentMessage(msg as ContentMessage, sender.tab?.id);
  work.then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});

// Switching Evalix OFF stops any running session immediately.
chrome.storage.onChanged.addListener(async (changes) => {
  const next = changes.settings?.newValue as Settings | undefined;
  if (next && next.enabled === false && isActive((await getStore()).session)) {
    await stopSession("Evalix switched OFF");
  }
});

// Closing the session's tab ends the session.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { session } = await getStore();
  if (isActive(session) && session.tabId === tabId) await stopSession("Assessment tab closed");
});

async function handlePopup(msg: PopupMessage): Promise<unknown> {
  switch (msg.type) {
    case "CHECK_BACKEND":
      return checkBackend();
    case "PROBE_TAB":
      return probeTab(msg.tabId);
    case "START_SESSION":
      return startSession(msg.tabId);
    case "STOP_SESSION":
      await stopSession();
      return { ok: true };
  }
}

/** Asks the tab's content script what it sees. No content script (non-localhost page) => not detected. */
async function probeTab(tabId: number): Promise<ProbeReply> {
  try {
    const reply = (await chrome.tabs.sendMessage(tabId, { type: "PROBE" } satisfies BackgroundMessage)) as ProbeReply;
    return reply ?? { page: null, complete: false, question: null };
  } catch {
    return { page: null, complete: false, question: null };
  }
}

export async function checkBackend(): Promise<BackendStatus> {
  const { backendUrl } = await getSettings();
  let status: BackendStatus;
  try {
    const health = await api.health(backendUrl);
    status = { online: health.status === "ok", checkedAt: Date.now(), health, error: null };
  } catch (err) {
    status = { online: false, checkedAt: Date.now(), health: null, error: (err as Error).message };
  }
  await setBackendStatus(status);
  return status;
}
