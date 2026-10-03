// Content script entry: runs on localhost pages, but does nothing unless the page opts in.
import type { BackgroundMessage, ProbeReply } from "../shared/messages";
import { resolveAdapter } from "./adapters";

const adapter = resolveAdapter(document);

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, _sender, sendResponse) => {
  if (msg.type === "PROBE") {
    const reply: ProbeReply = {
      page: adapter?.detect(document) ?? null,
      complete: adapter?.isComplete(document) ?? false,
      question: adapter?.extract(document)?.question ?? null,
    };
    sendResponse(reply);
  }
  return false;
});
