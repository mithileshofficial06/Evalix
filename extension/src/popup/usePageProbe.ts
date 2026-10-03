import { useEffect, useState } from "react";
import type { PopupMessage, ProbeReply } from "../shared/messages";

export interface ActiveTabProbe {
  tabId: number | null;
  probe: ProbeReply | null;
}

// Polls the active tab's content script so the popup shows what Evalix detects on the page.
export function usePageProbe(intervalMs = 1000): ActiveTabProbe {
  const [state, setState] = useState<ActiveTabProbe>({ tabId: null, probe: null });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      const probe = (await chrome.runtime.sendMessage({ type: "PROBE_TAB", tabId: tab.id } satisfies PopupMessage)) as ProbeReply;
      if (alive) setState({ tabId: tab.id, probe });
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return state;
}
