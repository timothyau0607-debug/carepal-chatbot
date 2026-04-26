"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type UserRole,
  parseUserRole,
} from "@/lib/carepal/user-role";

const STORAGE_KEY = "carepal_user_key";
const ROLE_KEY = "carepal_user_role";

/**
 * 裝置識別＋左欄選擇的使用者脈絡（家屬／病者／醫護）；皆存於 localStorage。
 */
export function useCarePalIdentity(): {
  userKey: string | null;
  userRole: UserRole;
  setUserRole: (r: UserRole) => void;
} {
  const [userKey, setUserKey] = useState<string | null>(null);
  const [userRole, setUserRoleState] = useState<UserRole>("family");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      let k = localStorage.getItem(STORAGE_KEY);
      if (!k) {
        k = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEY, k);
      }
      const r = localStorage.getItem(ROLE_KEY);
      queueMicrotask(() => {
        setUserKey(k);
        setUserRoleState(parseUserRole(r));
      });
    } catch {
      queueMicrotask(() => {
        setUserKey(null);
        setUserRoleState("family");
      });
    }
  }, []);

  const setUserRole = useCallback((r: UserRole) => {
    setUserRoleState(r);
    try {
      localStorage.setItem(ROLE_KEY, r);
    } catch {
      /* ignore */
    }
  }, []);

  return { userKey, userRole, setUserRole };
}
