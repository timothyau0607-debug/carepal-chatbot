import type { SupabaseClient } from "@supabase/supabase-js";

/** 以台灣日曆日作為「今日」摘要邊界 */
export function todayDateTaipei(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export type StaffFeedRow = {
  one_line: string;
  questions_asked: string;
  praise_for_staff: string;
  /** 家屬/病友之去識別稱呼；寫入 DB 供醫護端轉述用 */
  contributor_display_name?: string;
};

const MAX_LINE = 500;
const MAX_Q = 1200;
const MAX_P = 800;

/** 醫護本則發言是否大致為提問／求助（非則較適合先主動帶正向回饋）。 */
export function looksLikeStaffQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/[？?]/.test(t)) return true;
  if (
    /^(請問|想請教|想了解|可否|能不能|要不要|該怎|如何|怎麼|為什麼|是不是|有沒有|是否)/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /(怎(麼|樣)辦|要注意|建議|哪裡查|可否幫|能否|行不行|可不可以)/.test(t)
  ) {
    return true;
  }
  if (t.length <= 160 && /(嗎|呢)[！!。…\s]*$/u.test(t)) return true;
  return false;
}

const STAFF_PRAISE_TIMING_MIN = 2;
const STAFF_PRAISE_TIMING_MAX = 4;

/**
 * 醫護端第 2～4 則訊息左右：提醒主動轉述今日家屬／病友的感謝、讚美、好評（需先有非空今日回饋區）。
 */
export function buildStaffPraiseTimingHint(params: {
  userMessageCount: number;
  lastUserText: string;
  hasStaffFeed: boolean;
}): string {
  if (!params.hasStaffFeed) return "";
  const uc = params.userMessageCount;
  if (uc < STAFF_PRAISE_TIMING_MIN || uc > STAFF_PRAISE_TIMING_MAX) {
    return "";
  }
  const q = looksLikeStaffQuestion(params.lastUserText);
  const phase = `你是醫護端的第 ${uc} 則發言（約在第 ${STAFF_PRAISE_TIMING_MIN}～${STAFF_PRAISE_TIMING_MAX} 則區間）。`;
  if (q) {
    return `【醫護對談節奏】${phase}對方本則**有具體提問或求助**時：請先**簡要有條理**作答；若「今日家屬／病友回饋」中有**感謝、讚美或好評摘錄**，可在**開頭一句**或**收尾一句**自然帶到（口語、短），遵守該區【轉述方式】；**勿**因提問就完全略過正向回饋。`;
  }
  return `【醫護對談節奏—優先正向回饋】${phase}對方本則**未見明確提問**、偏寒暄或僅閒聊時：**務必**先以**一至二句口語**，依「今日家屬／病友回饋」主動轉述病友／家屬的**感謝、讚美或對醫護／院方的好評**（不必等對方先問），再輕輕承接；遵守【轉述方式】。**嚴禁**杜撰、**僅**依摘錄。`;
}

/**
 * 家屬/病友一輪發言後，合併寫入「今日」一筆（每人每天一列）。
 */
export async function upsertTodayStaffFeed(
  supabase: SupabaseClient,
  contributorKey: string,
  contributorRole: "family" | "patient",
  next: StaffFeedRow
): Promise<void> {
  const d = todayDateTaipei();
  const o = next.one_line.replace(/\r\n/g, "\n").trim().slice(0, MAX_LINE);
  const q = next.questions_asked
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, MAX_Q);
  const p = next.praise_for_staff
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, MAX_P);
  const dn = (next.contributor_display_name ?? "")
    .replace(/\r\n/g, " ")
    .trim()
    .slice(0, 64);
  if (!o && !q && !p) return;

  const { error } = await supabase.from("carepal_staff_feed").upsert(
    {
      contributor_key: contributorKey,
      contributor_role: contributorRole,
      signal_date: d,
      one_line: o,
      questions_asked: q,
      praise_for_staff: p,
      ...(dn ? { contributor_display_name: dn } : {}),
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "contributor_key,contributor_role,signal_date",
    }
  );
  if (error) throw error;
}

/**
 * 供醫護 system prompt；若無表或尚無列則回空字串。
 */
export async function formatTodayStaffFeedForSystemPrompt(
  supabase: SupabaseClient
): Promise<string> {
  const d = todayDateTaipei();
  const { data, error } = await supabase
    .from("carepal_staff_feed")
    .select(
      "contributor_key, contributor_role, contributor_display_name, one_line, questions_asked, praise_for_staff, updated_at"
    )
    .eq("signal_date", d)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[carepal] formatTodayStaffFeed", error);
    return "";
  }
  const rows = data ?? [];
  if (rows.length === 0) return "";

  const lines: string[] = [
    "【今日家屬／病友回饋（院內彙整、去識別；含對醫護的讚美與感謝、對院方／就醫體驗的正面評價；可短述給醫護團隊情緒支持）】",
    "【轉述方式】若本日有「讚美、感謝」內容：對話**開場可主動**一句帶到——今天有病友／家屬想透過你向團隊或某位同仁道謝（勿等對方先問）。**在約第 2～4 則醫護發言時**（對方**沒有**要你先回覆具體提問或偏閒聊時），**優先**主動一句帶正向回饋；若對方**有明確提問**，請先簡答，再於前後擇一自然帶一句，**不要**略過摘錄中有依據的好評。若某一則摘錄有「回饋者稱呼」，轉述給**被指名的醫護**時可用口語媒介句，例如：「〇〇有想請我跟你說一聲，謝謝你的照顧」——**〇〇僅能**用摘錄中標示的**回饋者稱呼**，且「被指名」須與「讚美、感謝」原文能合理對上「已記得資訊」裡**當前醫護**的稱呼／職稱（同一人）；對不上則只做**團隊／一般**讚美轉述，**不**硬套名字。**嚴禁**杜撰稱呼或感謝。若僅有其它欄而無讚美，仍可一句帶到「今天有人想謝謝大家照顧」類訊息，維持簡短。",
    "【具名感謝對照】摘錄「讚美、感謝」欄若含**特定同仁姓名／職稱**（例如「林小陽護士」「謝醫師」），請對照「已記得資訊」第一行「稱呼或識別」是否為當前對談醫護之本名或簡稱（姓氏一致且簡稱可對上、或全名相符）：**對得上**時，可用第二人稱親切轉述，例如「家屬陳大文提到很感謝小陽你的幫忙，覺得你很細心」——「家屬／病友某某」須來自上列「回饋者稱呼」或摘錄明文；「小陽」僅在摘錄已出現或可與對談醫護姓名合理對照時使用。**對不上**時改為泛述「有病友／家屬提到某位護理師很受肯定」，勿臆測全院同仁姓名。**嚴禁**杜撰摘錄未出現的人名與細節。",
  ];
  for (const r of rows) {
    const role =
      (r as { contributor_role?: string }).contributor_role === "patient"
        ? "病友"
        : "家屬";
    const k = (r as { contributor_key?: string }).contributor_key ?? "";
    const shortK = k.length > 8 ? k.slice(0, 4) + "…" : k;
    const displayName = (
      (r as { contributor_display_name?: string }).contributor_display_name ?? ""
    ).trim();
    const who = displayName || shortK;
    const ol = ((r as { one_line?: string }).one_line ?? "").trim();
    const qq = ((r as { questions_asked?: string }).questions_asked ?? "").trim();
    const pr = ((r as { praise_for_staff?: string }).praise_for_staff ?? "").trim();
    if (!ol && !qq && !pr) continue;
    const bits: string[] = [];
    if (ol) bits.push(`情境：${ol}`);
    if (qq) bits.push(`常問/關心：${qq}`);
    if (pr) bits.push(`讚美、感謝或院方好評：${pr}`);
    lines.push(
      `— ${role}（回饋者稱呼：${who}）${bits.join("；")}`
    );
  }
  if (lines.length <= 3) return "";
  return lines.join("\n");
}
