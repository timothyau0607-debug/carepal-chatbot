const MAX_DISPLAY = 64;

/**
 * 寫入 carepal_profiles.display_name。不合法（佔位、刪節號、純標點等）回空字串，上層應**略過**覆寫。
 */
export function sanitizeDisplayName(raw: string): string {
  let s = raw.replace(/\r\n/g, " ").replace(/\n/g, " ").trim();
  s = s.replace(/\s{2,}/g, " ").slice(0, MAX_DISPLAY);
  if (!s) return "";
  if (/^(訪客|visitor|guest)$/i.test(s)) return "";
  if (s.length > 32 && /[。！？，；]/.test(s)) return "";
  if (isDisplayNamePlaceholder(s)) return "";
  return s;
}

/** 常見誤寫：模型抄範例「…」、刪節號、或僅標點 */
function isDisplayNamePlaceholder(s: string): boolean {
  if (/^\.{1,4}$/u.test(s)) return true;
  if (/^…{1,4}$/u.test(s)) return true;
  if (/^(\.{3,}|…+|……+)$/.test(s)) return true;
  if (/^[\s.\u00b7\u2026…。．·•‧\-—_~～・･]+$/u.test(s)) return true;
  return false;
}
