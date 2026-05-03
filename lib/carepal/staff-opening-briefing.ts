import type { SupabaseClient } from "@supabase/supabase-js";
import { todayDateTaipei } from "@/lib/carepal/staff-feed";

const MAX_BRIEFING = 1100;
const PROFILE_SCAN_LIMIT = 100;

function dayStartTaipeiIso(): string {
  return `${todayDateTaipei()}T00:00:00+08:00`;
}

/** 今日 carepal_staff_feed → 一口氣講完的聊天句（無報表標題） */
async function conversationalFromStaffFeed(
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
        samples.push(pr.length > 100 ? pr.slice(0, 100) + "…" : pr);
      }
    }
  }

  let s = "";
  s += `對了～今天（${d}）線上有 ${active.length} 位病友或家屬，順手留了「今日摘要」裡的情境或關心，我幫你們喵了一眼。`;

  if (praiseLines > 0) {
    s += ` 裡頭大概有 ${praiseLines} 段，是真心在謝謝大家、或在誇團隊跟院這邊的照顧，聽了就覺得很值得跟大家分享。`;
  } else if (samples.length === 0) {
    s += ` 多半是陪診、照顧脈絡，讚美的字還不算多，但今天至少有人記得來說一句，也很珍貴。`;
  }

  if (samples.length > 0) {
    const q = samples.map((x) => `也有人用口語聊到：「${x}」`);
    s += ` ${q.join("；")}——細節我都有做去辨識，你就當加餐廳小菜，收下心意就好哈。`;
  }

  return s.trim();
}

/** 線上按鈕／互動欄 → 一口氣聊天句 */
async function conversationalFromProfileUiSignals(
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
            body.length > 95 ? body.slice(0, 95) + "…" : body
          );
        }
      }
    }
  }

  if (cheer + like + letters === 0) return "";

  const bits: string[] = [];
  if (cheer > 0) {
    bits.push(
      cheer === 1
        ? "有人默默按了一次「打氣」鍵"
        : `有人按「打氣」大概 ${cheer} 次`
    );
  }
  if (like > 0) {
    bits.push(
      like === 1 ? "也有人按個讚示意" : `按「讚」的有 ${like} 次上下`
    );
  }
  if (letters > 0) {
    bits.push(
      letters === 1
        ? "還有一人打字留言想把話留給團隊"
        : `另外有 ${letters} 則是打字留下來的祝福或感謝`
    );
  }

  let s =
    `還有小插曲：對話區塊這邊，${bits.join("，")}，像是在跟你們隔空比個愛心、說聲謝謝你們在。`;

  if (letterSnips.length > 0) {
    s += ` 順手替你們捎一句：` +
      letterSnips.map((x) => `「${x}」`).join("、") +
      `——一樣是摘錄、別當逐字公文喔。`;
  }

  return s.trim();
}

/**
 * 醫護開場「第二段」用：以小晴聊天的口吻講今日暖心事；無資料時回空字串。
 * 招呼語本身仍由 hospital-welcome 先講。
 */
export async function buildStaffOpeningBriefingForWelcome(
  supabase: SupabaseClient
): Promise<string> {
  const [feedPara, uiPara] = await Promise.all([
    conversationalFromStaffFeed(supabase),
    conversationalFromProfileUiSignals(supabase),
  ]);

  const blocks = [feedPara, uiPara].filter((x) => x.length > 0);
  if (blocks.length === 0) return "";

  let out = blocks.join("\n\n");
  out +=
    `\n\n（以上都是線上自動摘來的暖心片段～不保證逐字對得起原文，就只是先讓你們知道自己的付出有被看見啦。）`;
  return out.slice(0, MAX_BRIEFING);
}
