"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "carepal_user_key";

/**
 * 瀏覽器端產生並存於 localStorage 的裝置／訪客識別，上線由 Supabase 與 long-term 記憶關聯。
 * 未登入情境下不取代正式帳號體系；之後可改為與 auth user id 合併。
 */
export function useCarePalUser(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      let k = localStorage.getItem(STORAGE_KEY);
      if (!k) {
        k = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEY, k);
      }
      queueMicrotask(() => setKey(k));
    } catch {
      queueMicrotask(() => setKey(null));
    }
  }, []);
  return key;
}
