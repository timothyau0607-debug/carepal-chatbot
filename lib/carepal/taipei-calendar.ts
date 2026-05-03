/** 以台灣日曆日作為「今日」邊界（en-CA YYYY-MM-DD） */
export function todayDateTaipei(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/** en-CA YYYY-MM-DD，以 Asia/Taipei 日曆加減天數 */
export function addCalendarDaysTaipei(enCaDay: string, deltaDays: number): string {
  const [y, m, d] = enCaDay.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return enCaDay;
  }
  const u = Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0);
  return new Date(u).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function yesterdayDateTaipei(): string {
  return addCalendarDaysTaipei(todayDateTaipei(), -1);
}

export function dayStartTaipeiIso(enCaDay: string): string {
  return `${enCaDay}T00:00:00+08:00`;
}

/** ISO / DB timestamptz → 台北日曆 en-CA */
export function isoToEnCaTaipei(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return todayDateTaipei();
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/**
 * 從紀錄行取出訊號所屬台北日（YYYY-MM-DD）。
 * 新格式：`[介面紀錄｜2026-05-03 14:35]…`、`[對話區留言…｜2026-05-03 14:35]…`
 * 取不到時回 null（由呼叫端用列 updated_at 推斷）。
 */
export function extractSignalEnCaDateFromLine(line: string): string | null {
  const t = line.trim();
  const m = t.match(
    /^\[[^\]|｜]*[|｜](\d{4}-\d{2}-\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\]/
  );
  if (m) return m[1] ?? null;
  const mSlash = t.match(
    /^\[[^\]|｜]*[|｜](\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[^\]]*)\]/
  );
  if (mSlash) {
    const Y = mSlash[1]!;
    const Mo = mSlash[2]!.padStart(2, "0");
    const Dd = mSlash[3]!.padStart(2, "0");
    return `${Y}-${Mo}-${Dd}`;
  }
  const m2 = t.match(
    /[|｜](\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/
  );
  if (m2) {
    const Y = m2[1]!;
    const Mo = m2[2]!.padStart(2, "0");
    const Dd = m2[3]!.padStart(2, "0");
    return `${Y}-${Mo}-${Dd}`;
  }
  return null;
}
