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
    "【轉述方式】若本日有「讚美、感謝」內容：對話**開場可主動**一句帶到——今天有病友／家屬想透過你向團隊或某位同仁道謝（勿等對方先問）。若某一則摘錄有「回饋者稱呼」，轉述給**被指名的醫護**時可用口語媒介句，例如：「〇〇有想請我跟你說一聲，謝謝你的照顧」——**〇〇僅能**用摘錄中標示的**回饋者稱呼**，且「被指名」須與「讚美、感謝」原文能合理對上「已記得資訊」裡**當前醫護**的稱呼／職稱（同一人）；對不上則只做**團隊／一般**讚美轉述，**不**硬套名字。**嚴禁**杜撰稱呼或感謝。若僅有其它欄而無讚美，仍可一句帶到「今天有人想謝謝大家照顧」類訊息，維持簡短。",
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
  if (lines.length <= 2) return "";
  return lines.join("\n");
}
