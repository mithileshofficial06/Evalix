import { useState } from "react";
import type { PopupMessage, ProbeReply, StartReply } from "../shared/messages";
import { updateSettings } from "../shared/storage";
import type { ProviderMode, Session, Settings } from "../shared/types";

const PROVIDERS: ProviderMode[] = ["AUTO", "MISTRAL", "NVIDIA", "MOCK"];

interface Props {
  settings: Settings;
  session: Session | null;
  active: boolean;
  tabId: number | null;
  probe: ProbeReply | null;
  backendOnline: boolean;
}

export function Controls({ settings, session, active, tabId, probe, backendOnline }: Props) {
  const [error, setError] = useState<string | null>(null);
  const automationAllowed = probe?.page?.automationAllowed ?? false;

  const start = async () => {
    if (tabId == null) return;
    setError(null);
    const reply = (await chrome.runtime.sendMessage({ type: "START_SESSION", tabId } satisfies PopupMessage)) as StartReply;
    if (!reply.ok) setError(reply.error);
  };
  const stop = () => chrome.runtime.sendMessage({ type: "STOP_SESSION" } satisfies PopupMessage);

  const blocker = !settings.enabled
    ? "Evalix is OFF"
    : !backendOnline
      ? "Backend offline"
      : !probe?.page
        ? "No Evalix-enabled assessment on this tab"
        : settings.mode === "automation" && !automationAllowed
          ? "Automation is only allowed on synthetic pages"
          : null;

  return (
    <section className="card">
      <h2>Mode</h2>
      <div className="segmented">
        <button className={settings.mode === "dry-run" ? "active" : ""} disabled={active} onClick={() => updateSettings({ mode: "dry-run" })}>
          Dry Run
        </button>
        <button
          className={settings.mode === "automation" ? "active" : ""}
          disabled={active || (!!probe?.page && !automationAllowed)}
          title={automationAllowed ? "" : "Only available on pages with evalix-environment=synthetic"}
          onClick={() => updateSettings({ mode: "automation" })}
        >
          Automation
        </button>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <span>AI provider</span>
        <select value={settings.provider} disabled={active} onChange={(e) => updateSettings({ provider: e.target.value as ProviderMode })}>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        {active ? (
          <button className="primary" style={{ width: "100%" }} onClick={stop}>
            STOP
          </button>
        ) : (
          <button className="primary" style={{ width: "100%" }} disabled={!!blocker || tabId == null} onClick={start}>
            START
          </button>
        )}
      </div>
      {!active && blocker && <p className="notice">{blocker}</p>}
      {error && <p className="notice err">{error}</p>}
      {session && !active && session.state !== "idle" && (
        <p className="notice">Last session: {session.state}</p>
      )}
    </section>
  );
}
