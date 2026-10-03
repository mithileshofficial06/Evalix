import { useEffect } from "react";
import { updateSettings } from "../shared/storage";
import type { PopupMessage } from "../shared/messages";
import { useStore } from "./useStore";

const send = (msg: PopupMessage) => chrome.runtime.sendMessage(msg);

export function App() {
  const store = useStore();

  // Re-check the backend while the popup is open.
  useEffect(() => {
    send({ type: "CHECK_BACKEND" });
    const id = setInterval(() => send({ type: "CHECK_BACKEND" }), 5000);
    return () => clearInterval(id);
  }, []);

  if (!store) return null;
  const { settings, backend } = store;
  const providerConfigured = (name: string) =>
    backend?.health?.providers.find((p) => p.name === name)?.configured ?? false;
  const aiReady =
    settings.provider === "AUTO"
      ? providerConfigured("MISTRAL") || providerConfigured("NVIDIA")
      : providerConfigured(settings.provider);

  return (
    <div className="popup">
      <header>
        <h1>EVALIX</h1>
        <p className="subtitle">AI Assessment Engine</p>
      </header>

      <section className="row">
        <span>Extension</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => updateSettings({ enabled: e.target.checked })}
          />
          <span>{settings.enabled ? "ON" : "OFF"}</span>
        </label>
      </section>

      <section className="card">
        <dl className="kv">
          <dt>Backend</dt>
          <dd>
            <span className={`dot ${backend?.online ? "ok" : "err"}`} />
            {backend?.online ? "Online" : "Offline"}
          </dd>
          <dt>AI</dt>
          <dd>
            <span className={`dot ${aiReady ? "ok" : "warn"}`} />
            {aiReady ? "Connected" : "Not configured"}
          </dd>
        </dl>
        {!backend?.online && (
          <p className="notice err">Start the backend: scripts\run-backend.ps1 ({settings.backendUrl})</p>
        )}
      </section>
    </div>
  );
}
