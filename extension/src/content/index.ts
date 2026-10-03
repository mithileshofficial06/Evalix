// Content script entry: runs on localhost pages, but does nothing unless the page opts in.
import type { AskReply, BackgroundMessage, ContentMessage, HelloReply, ProbeReply } from "../shared/messages";
import { resolveAdapter } from "./adapters";
import { Bridge, Runner } from "./runner";

const send = <T = unknown>(msg: ContentMessage) => chrome.runtime.sendMessage(msg) as Promise<T>;
const fire = (msg: ContentMessage) => void send(msg).catch(() => undefined);

const bridge: Bridge = {
  ask: (question) => send<AskReply>({ type: "ASK", question }),
  questionStarted: (question) => fire({ type: "QUESTION_STARTED", question }),
  result: (result) => fire({ type: "RESULT", result }),
  state: (state) => fire({ type: "STATE", state }),
  log: (level, message) => fire({ type: "LOG", level, message }),
  complete: () => fire({ type: "COMPLETE" }),
  failed: (error) => fire({ type: "FAILED", error }),
};

const adapter = resolveAdapter(document);
const page = adapter?.detect(document) ?? null;
const runner = adapter ? new Runner(adapter, document, bridge) : null;

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, _sender, sendResponse) => {
  switch (msg.type) {
    case "PROBE": {
      const reply: ProbeReply = {
        page: adapter?.detect(document) ?? null,
        complete: adapter?.isComplete(document) ?? false,
        question: adapter?.extract(document)?.question ?? null,
      };
      sendResponse(reply);
      break;
    }
    case "RUN":
      runner?.start(msg.mode);
      break;
    case "STOP":
      runner?.stop();
      break;
  }
  return false;
});

// On every page load, ask whether this tab is mid-session (e.g. we just navigated to the
// completion page) and resume if so.
if (page && runner) {
  send<HelloReply>({ type: "HELLO", page })
    .then((reply) => reply?.run && runner.start(reply.run))
    .catch(() => undefined);
}
