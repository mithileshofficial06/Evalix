// Typed wrappers over chrome.storage.local. The service worker can be killed at any time,
// so all state that must survive (settings, session, backend status) lives here.
import { BackendStatus, DEFAULT_SETTINGS, Session, Settings } from "./types";

export interface StoreShape {
  settings: Settings;
  session: Session | null;
  backend: BackendStatus | null;
}

export async function getStore(): Promise<StoreShape> {
  const raw = (await chrome.storage.local.get(["settings", "session", "backend"])) as Partial<StoreShape>;
  return {
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    session: raw.session ?? null,
    backend: raw.backend ?? null,
  };
}

export async function getSettings(): Promise<Settings> {
  return (await getStore()).settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function setSession(session: Session | null): Promise<void> {
  await chrome.storage.local.set({ session });
}

export async function setBackendStatus(backend: BackendStatus): Promise<void> {
  await chrome.storage.local.set({ backend });
}
