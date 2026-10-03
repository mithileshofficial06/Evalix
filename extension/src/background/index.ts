// Background service worker: owns settings and session state and is the only
// component that talks to the local backend.
import { getSettings, setBackendStatus, updateSettings } from "../shared/storage";
import type { BackgroundMessage, PopupMessage, ProbeReply } from "../shared/messages";
import type { BackendStatus } from "../shared/types";
import { api } from "./api";

chrome.runtime.onInstalled.addListener(async () => {
  // Persist defaults so the popup and content scripts read a complete settings object.
  await updateSettings({});
  await checkBackend();
});

chrome.runtime.onMessage.addListener((msg: PopupMessage, _sender, sendResponse) => {
  handle(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});

async function handle(msg: PopupMessage): Promise<unknown> {
  switch (msg.type) {
    case "CHECK_BACKEND":
      return checkBackend();
    case "PROBE_TAB":
      return probeTab(msg.tabId);
    default:
      return { ok: false, error: `Unhandled message: ${(msg as { type: string }).type}` };
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
