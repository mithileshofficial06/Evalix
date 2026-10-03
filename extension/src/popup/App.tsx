import { updateSettings } from "../shared/storage";
import { useStore } from "./useStore";

export function App() {
  const store = useStore();
  if (!store) return null;
  const { settings } = store;

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
    </div>
  );
}
