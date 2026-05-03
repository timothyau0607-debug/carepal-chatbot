import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dayStartTaipeiIso,
  extractSignalEnCaDateFromLine,
  isoToEnCaTaipei,
  todayDateTaipei,
  yesterdayDateTaipei,
} from "@/lib/carepal/taipei-calendar";

const MAX_BRIEFING = 1100;
const PROFILE_SCAN_LIMIT = 200;

type UiAgg = { cheer: number; like: number; letters: number; letterSnips: string[] };

function emptyAgg(): UiAgg {
  return { cheer: 0, like: 0, letters: 0, letterSnips: [] };
}

async function conversationalFromStaffFeedForDate(
  supabase: SupabaseClient,
  signalDate: string,
  tense: "today" | "yesterday"
): Promise<string> {
  const { data, error } = await supabase
    .from("carepal_staff_feed")
    .select(
      "contributor_role, contributor_display_name, one_line, questions_asked, praise_for_staff, updated_at"
    )
    .eq("signal_date", signalDate)
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

  const dayWord = tense === "today" ? "今天" : "昨天";

  let s = "";
  s += `對了～${dayWord}（${signalDate}）線上有 ${active.length} 位病友或家屬，順手留了「${dayWord}摘要」裡的情境或關心，我幫你們喵了一眼。`;

  if (praiseLines > 0) {
    s += ` 裡頭大概有 ${praiseLines} 段，是真心在謝謝大家、或在誇團隊跟院這邊的照顧，聽了就覺得很值得跟大家分享。`;
  } else if (samples.length === 0) {
    s +=
      tense === "today"
        ? ` 多半是陪診、照顧脈絡，讚美的字還不算多，但今天至少有人記得來說一句，也很珍貴。`
        : ` 多半是陪診、照顧脈絡，讚美的字還不算多，不過昨天也有人記得來說一句，也很珍貴。`;
  }

  if (samples.length > 0) {
    const q = samples.map((x) => `也有人用口語聊到：「${x}」`);
    s += ` ${q.join("；")}——細節我都有做去辨識，你就當加餐廳小菜，收下心意就好哈。`;
  }

  return s.trim();
}

async function aggregateProfileUiByTaipeiDay(
  supabase: SupabaseClient
): Promise<{ todayAgg: UiAgg; yesterdayAgg: UiAgg }> {
  const yStart = dayStartTaipeiIso(yesterdayDateTaipei());
  const { data, error } = await supabase
    .from("carepal_profiles")
    .select(
      "staff_interaction_satisfaction, updated_at"
    )
    .in("user_role", ["family", "patient"])
    .gte("updated_at", yStart)
    .not("staff_interaction_satisfaction", "eq", "")
    .limit(PROFILE_SCAN_LIMIT);
  if (error || !data?.length)
    return { todayAgg: emptyAgg(), yesterdayAgg: emptyAgg() };

  const todayD = todayDateTaipei();
  const yestD = yesterdayDateTaipei();
  const todayAgg = emptyAgg();
  const yesterdayAgg = emptyAgg();

  for (const row of data) {
    const satisfaction = (
      row as { staff_interaction_satisfaction?: string }
    ).staff_interaction_satisfaction ?? "";
    const updatedAt =
      typeof (row as { updated_at?: string }).updated_at === "string"
        ? ((row as { updated_at: string }).updated_at)
        : "";
    const fallbackDay =
      updatedAt.length > 0 ? isoToEnCaTaipei(updatedAt) : todayD;

    for (const line of satisfaction.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (!t.includes("[介面紀錄") && !t.includes("[對話區留言")) continue;
      const day = extractSignalEnCaDateFromLine(t) ?? fallbackDay;
      const bucket =
        day === todayD ? todayAgg : day === yestD ? yesterdayAgg : null;
      if (!bucket) continue;

      if (t.includes("[介面紀錄")) {
        if (t.includes("「打氣」")) bucket.cheer++;
        if (t.includes("「按讚」")) bucket.like++;
      }
      if (t.includes("[對話區留言")) {
        bucket.letters++;
        const body = t.replace(/^\[[^\]]+\]\s*/, "").trim();
        if (body.length > 8 && bucket.letterSnips.length < 2) {
          bucket.letterSnips.push(
            body.length > 95 ? body.slice(0, 95) + "…" : body
          );
        }
      }
    }
  }

  return { todayAgg, yesterdayAgg };
}

function conversationalFromUiAgg(agg: UiAgg, tense: "today" | "yesterday"): string {
  const { cheer, like, letters, letterSnips } = agg;
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

  const tenseHint =
    tense === "today"
      ? "對話區塊這邊"
      : "對話區塊這邊（發生在昨天的紀錄）";

  let s =
    `還有小插曲：${tenseHint}，${bits.join("，")}，像是在跟你們隔空比個愛心、說聲謝謝你們在。`;

  if (letterSnips.length > 0) {
    s +=
      ` 順手替你們捎一句：` +
      letterSnips.map((x) => `「${x}」`).join("、") +
      `——一樣是摘錄、別當逐字公文喔。`;
  }

  return s.trim();
}

/**
 * 醫護開場「第二段」用：以小晴聊天的口吻講今日暖心事；無資料時回空字串。
 * 優先彙整「今天」的 staff_feed 與介面訊號；若今天兩邊都沒有，才用「昨天」並先交代一句。
 */
export async function buildStaffOpeningBriefingForWelcome(
  supabase: SupabaseClient
): Promise<string> {
  const todayD = todayDateTaipei();
  const yestD = yesterdayDateTaipei();

  const [{ todayAgg, yesterdayAgg }, feedToday, feedYesterday] =
    await Promise.all([
      aggregateProfileUiByTaipeiDay(supabase),
      conversationalFromStaffFeedForDate(supabase, todayD, "today"),
      conversationalFromStaffFeedForDate(supabase, yestD, "yesterday"),
    ]);

  const uiToday = conversationalFromUiAgg(todayAgg, "today");
  const uiYesterday = conversationalFromUiAgg(yesterdayAgg, "yesterday");

  const todayHas = feedToday.length > 0 || uiToday.length > 0;
  const yesterdayHas = feedYesterday.length > 0 || uiYesterday.length > 0;

  let prefix = "";
  let blocks: string[];

  if (todayHas) {
    blocks = [feedToday, uiToday].filter((x) => x.length > 0);
  } else if (yesterdayHas) {
    prefix =
      `今天（${todayD}）線上還沒有新的暖心摘要或按讚／打氣／留言紀錄，先跟你們說昨天（${yestD}）大家留下的⋯`;
    blocks = [feedYesterday, uiYesterday].filter((x) => x.length > 0);
  } else {
    return "";
  }

  let out = [prefix, ...blocks].filter((x) => x.length > 0).join("\n\n");
  out +=
    `\n\n（以上都是線上自動摘來的暖心片段～不保證逐字對得起原文，就只是先讓你們知道自己的付出有被看見啦。）`;
  return out.slice(0, MAX_BRIEFING);
}
