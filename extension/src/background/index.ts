// Background service worker: owns settings and session state and is the only
// component that talks to the local backend.
import { getStore, updateSettings } from "../shared/storage";
import type { PopupMessage } from "../shared/messages";

chrome.runtime.onInstalled.addListener(async () => {
  // Persist defaults so the popup and content scripts read a complete settings object.
  await updateSettings({});
});

chrome.runtime.onMessage.addListener((msg: PopupMessage, _sender, sendResponse) => {
  handle(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});

async function handle(msg: PopupMessage): Promise<unknown> {
  switch (msg.type) {
    default:
      return { ok: false, error: `Unhandled message: ${(msg as { type: string }).type}`, store: await getStore() };
  }
}
