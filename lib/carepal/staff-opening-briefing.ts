import type { SupabaseClient } from "@supabase/supabase-js";
import { todayDateTaipei } from "@/lib/carepal/staff-feed";

const MAX_BRIEFING = 1200;
const PROFILE_SCAN_LIMIT = 100;

function dayStartTaipeiIso(): string {
  return `${todayDateTaipei()}T00:00:00+08:00`;
}

/** 今日 carepal_staff_feed 一則給醫護開場用的口語摘段 */
async function snippetFromStaffFeed(
  supabase: SupabaseClient
): Promise<string> {
  const d = todayDateTaipei();
  const { data, error } = await supabase
    .from("carepal_staff_feed")
    .select(
      "contributor_role, contributor_display_name, one_line, questions_asked, praise_for_staff, updated_at"
    )
    .eq("signal_date", d)
    .order("updated_at", { ascending: false });
  if (error || !data?.length) return "";

  const active = data.filter((r) => {
    const row = r as {
      one_line?: string;
      questions_asked?: string;
      praise_for_staff?: string;
    };
    return (
      (row.one_line ?? "").trim() ||
      (row.questions_asked ?? "").trim() ||
      (row.praise_for_staff ?? "").trim()
    );
  });
  if (active.length === 0) return "";

  let praiseLines = 0;
  const samples: string[] = [];
  for (const raw of active) {
    const r = raw as { praise_for_staff?: string };
    const pr = (r.praise_for_staff ?? "").trim();
    if (pr) {
      praiseLines++;
      if (samples.length < 2) {
        samples.push(pr.length > 90 ? pr.slice(0, 90) + "…" : pr);
      }
    }
  }

  let s = `【今日回饋彙整表｜${d}】目前有 ${active.length} 位病友／家屬的今日摘要。`;
  if (praiseLines > 0) {
    s += `其中 ${praiseLines} 則有寫到對團隊的感謝或讚美。`;
  }
  if (samples.length > 0) {
    s += ` 摘意（去識別、勿當逐字證據）：${samples.map((x) => `「${x}」`).join("；")}`;
  }
  return s;
}

/** 今日 carepal_profiles 內「介面打氣／按讚／對話留言」合併摘段 */
async function snippetFromProfileUiSignals(
  supabase: SupabaseClient
): Promise<string> {
  const { data, error } = await supabase
    .from("carepal_profiles")
    .select(
      "user_role, display_name, staff_interaction_satisfaction, updated_at"
    )
    .in("user_role", ["family", "patient"])
    .gte("updated_at", dayStartTaipeiIso())
    .not("staff_interaction_satisfaction", "eq", "")
    .limit(PROFILE_SCAN_LIMIT);
  if (error || !data?.length) return "";

  let cheer = 0;
  let like = 0;
  let letters = 0;
  const letterSnips: string[] = [];

  for (const row of data) {
    const s = (row as { staff_interaction_satisfaction?: string })
      .staff_interaction_satisfaction ?? "";
    if (!s.includes("[介面紀錄") && !s.includes("[對話區留言")) continue;

    for (const line of s.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.includes("[介面紀錄")) {
        if (t.includes("「打氣」")) cheer++;
        if (t.includes("「按讚」")) like++;
      }
      if (t.includes("[對話區留言")) {
        letters++;
        const body = t.replace(/^\[[^\]]+\]\s*/, "").trim();
        if (body.length > 8 && letterSnips.length < 2) {
          letterSnips.push(
            body.length > 88 ? body.slice(0, 88) + "…" : body
          );
        }
      }
    }
  }

  if (cheer + like + letters === 0) return "";

  let out = `【線上按鈕與對話留言】今天有病友／家屬在「與醫護互動」欄留下紀錄：打氣 ${cheer} 次、按讚 ${like} 次、文字留言 ${letters} 則。`;
  if (letterSnips.length > 0) {
    out += ` 留言摘錄（去識別）：${letterSnips.map((x) => `「${x}」`).join("；")}`;
  }
  return out;
}

/**
 * 醫護端第一則開場前段：從 DB 彙整今日家屬／病友之打氣、按讚、留言與回饋表摘錄。
 * 無資料或查詢失敗時回空字串。
 */
export async function buildStaffOpeningBriefingForWelcome(
  supabase: SupabaseClient
): Promise<string> {
  const [feed, ui] = await Promise.all([
    snippetFromStaffFeed(supabase),
    snippetFromProfileUiSignals(supabase),
  ]);
  if (!feed && !ui) return "";

  const intro =
    "小晴先跟你說一聲：我從資料庫裡讀到今天有病友／家屬透過線上對話傳來的**打氣、按讚或留言**，以及寫進「今日回饋彙整」的重點（都已去識別，先讓護理師／團隊心裡有個底，不是正式通報）：";

  return [intro, feed, ui].filter((x) => x.trim().length > 0).join("\n\n").slice(0, MAX_BRIEFING);
}
