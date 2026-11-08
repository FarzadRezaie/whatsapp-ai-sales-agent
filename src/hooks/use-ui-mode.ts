"use client";

import { useCallback, useSyncExternalStore } from "react";

// ============================================================
// Simple vs advanced interface.
//
// Shops see a SIMPLE interface by default: only the screens they need
// (Home, Inbox, Products, AI assistant, Notifications, Settings).
// "Show advanced features" in the account menu reveals the full CRM
// (contacts, pipelines, broadcasts, automations, flows). Stored per
// device in localStorage; every tab updates together.
// ============================================================

export type UiMode = "simple" | "advanced";

const STORAGE_KEY = "app.ui-mode";
const EVENT = "app-ui-mode-change";

function read(): UiMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onChange);
  };
}

export function useUiMode(): {
  uiMode: UiMode;
  isAdvanced: boolean;
  setUiMode: (next: UiMode) => void;
} {
  const uiMode = useSyncExternalStore(subscribe, read, () => "simple" as UiMode);
  const setUiMode = useCallback((next: UiMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // private mode: the choice just won't persist
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { uiMode, isAdvanced: uiMode === "advanced", setUiMode };
}
