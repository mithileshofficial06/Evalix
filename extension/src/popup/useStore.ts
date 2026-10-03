import { useEffect, useState } from "react";
import { getStore, StoreShape } from "../shared/storage";

// Live view of chrome.storage.local: re-renders whenever the background updates state.
export function useStore(): StoreShape | null {
  const [store, setStore] = useState<StoreShape | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => getStore().then((s) => alive && setStore(s));
    refresh();
    chrome.storage.onChanged.addListener(refresh);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(refresh);
    };
  }, []);

  return store;
}
