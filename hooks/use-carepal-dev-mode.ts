"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "carepal_dev_mode";

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 「開發模式」：顯示 API 狀態、RAG、長期記憶編輯等。關閉時以外部 Demo 極簡介面為主。
 */
export function useCarePalDevMode(): {
  devMode: boolean;
  setDevMode: (next: boolean) => void;
} {
  const [devMode, setDevModeState] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setDevModeState(readStored()));
  }, []);

  const setDevMode = useCallback((next: boolean) => {
    setDevModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  return { devMode, setDevMode };
}
