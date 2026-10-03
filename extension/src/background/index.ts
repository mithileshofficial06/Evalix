// Background service worker: owns settings and session state and is the only
// component that talks to the local backend.
import { getSettings, setBackendStatus, updateSettings } from "../shared/storage";
import type { PopupMessage } from "../shared/messages";
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
    default:
      return { ok: false, error: `Unhandled message: ${(msg as { type: string }).type}` };
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
