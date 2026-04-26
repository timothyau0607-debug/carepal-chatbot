/** 用於從客戶端傳入、URL 的 user key 基本校驗（非嚴格 UUID，避免實作過度耦合） */
const USER_KEY_RE = /^[\w-]{8,128}$/;

export function isValidUserKey(s: string | undefined | null): s is string {
  if (typeof s !== "string" || s.length < 8) return false;
  return USER_KEY_RE.test(s);
}
