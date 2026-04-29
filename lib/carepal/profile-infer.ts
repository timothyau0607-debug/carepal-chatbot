import type { SupabaseClient } from "@supabase/supabase-js";
import { createChatLlm } from "@/lib/carepal/llm";
import { getOrCreateProfile } from "@/lib/carepal/memory-store";
import {
  type StaffFeedRow,
  todayDateTaipei,
  upsertTodayStaffFeed,
} from "@/lib/carepal/staff-feed";
import { sanitizeDisplayName } from "@/lib/carepal/display-name";
import { isPlaceholderStaffSatisfaction } from "@/lib/carepal/visit-staff-nudge";
import type { UserRole } from "@/lib/carepal/user-role";

const MAX_IN_USER = 1200;
const MAX_IN_ASST = 1000;
const MAX_INFERRED = 2200;
const MAX_PREF = 1800;
const MAX_TRAITS = 1500;
const MAX_VISIT = 1200;
const MAX_SAT = 1000;

const SYSTEM_TRIPLE = `你是資訊整理助理。任務是把「人類使用者」的長期、穩定資訊，整理成三類文字，供照護助理之後參考。

## 可採用的事實來源
- 以**使用者**在「你：」之後的陳述為主（稱呼、與**家人/被照顧者**的關係、關心的事、情緒、**使用者本人**的喜好與習慣、溝通方式）。
- 「小晴：」之後的內容**僅**用來理解前後文或使用者是在問什麼，**不可**當成使用者的敘事來寫入任何欄位。

## 嚴格禁止
1. **不可**把助理「小晴」、聊天機器人、或任何虛擬角色寫成「被照顧者」「關係對象」或「家屬」。若本輪沒有從**使用者**口中得知與**真人**的關係，就不要臆測關係；**絕對不要**寫成「關係：小晴」。
2. **不可**寫入小晴的**任何**回覆內文、喜好、觀點、衛教、勸導、條列建議、套語（如「建議與醫師討論」）到使用者欄位——**就當「小晴：」****不存在於****可寫入素材**；那些句子**不論多長**都**不得**以任何形式進 **inferred / preferences / traits**。
3. **不要**把衛教法規長文抄進畫像；知識型條文不要收錄。
4. 不要虛構醫療事實。

## 新舊抵觸以**新**為準
- 若**較新**的「你：」與「【既有】」在**同類事實**上**相矛盾、改口、或明確否定**先前說法，產出**以最新**之使用者敘事**為準**；須**改寫**該欄為內部一致、**不要**併陳兩套矛盾內容。
- 時間上**越晚、越明確**的陳述，優先於**較早、較籠統**的內容（**inferred、preferences、traits** 皆同）。

## 產出前自檢（必做）
- 針對每個要寫入的字串欄位：**逐句**自問：「這句在「你：」裡是使用者**親口**說的嗎，或**僅**出現在「小晴：」裡？」若**只**出現在「小晴：」→ **刪除該句**；若**整欄**因此無內容則**維持與「既有」欄位相同**（**不要**用助理台詞**填滿**）。

## 三欄分工
- **inferred**、**preferences**、**traits** 的意義同前；字數上限略同。

## 欄位 **display_name**
- **只依「你：」本輪**：若**本輪**明確**說出**希望被稱呼的稱呼、姓名、暱稱，填**一個**精簡字串，供寫入資料庫；否則**空字串**。**不可**從「小晴：」臆測；**禁止**「...」「…」刪節號或**純標點**佔位。
- **若使用者身分為醫護／護理／醫師同仁**：僅在其於「你：」**親口**自報姓名或希望被記住的稱呼時填入 display_name（例如「叫我林小陽」「敝姓林」「王小明護理師」），以便與今日「家屬／病友指名感謝」摘錄對照；無則 ""。

## 輸出格式
只回傳 JSON，**欄內可為真實內文**；**display_name 若本輪無自稱則用 ""，禁止**填刪節號「...」「…」或**純標點**佔位。
只回傳 JSON：{"inferred":"擔心家中長輩夜間安全","preferences":"喜歡具體步驟","traits":"語速快、易緊張","display_name":""}`;

const SYSTEM_FAMILY_PATIENT = `你是資訊整理助理。使用場景多為**醫院內**（家屬或病友與小晴對談）。請把「人類使用者」的長期資訊與**今日到院脈絡**整理到下列欄位，並產生一份**可給醫護人員參考**的短摘要（僅基於**你：**之後的內容，不可把小晴的台詞寫成使用者的讚美）。

## 可採用
- **唯一**寫入來源是「**你：**」的陳述。以下**均禁止**寫入任何欄位與 for_staff：「**小晴：**」之後的**整段**、衛教、步驟、勸導、套語、參考資料、助理口吻（如「建議與醫師討論」「幫你整理」等）。**若本輪「你：」沒有**新的可寫事實，各欄**維持與上列「既有」相同**，**不要**用助理的話**湊內容**。

## 新舊抵觸以**新**為準（**全**畫像欄位＋ **for_staff** 三子欄）
- **inferred、preferences、traits、visit_context、staff_interaction_satisfaction、for_staff**（**one_line / questions_asked / praise_for_staff**）皆適用。只要「【既有】」與**較新**的「你：」在**同一件事、同一關係、同一情境、同一觀感**上**衝突、改口、補正、或**後**說**否定**前說，產出**必須**以**最近、最明確**之使用者敘事**為準**；**整欄**就該欄**相關**部分**重寫**成單一一致說法，**刪去**已遭推翻的敘述，**不可**兩段矛盾內文並存。
- **越晚、越明確**的使用者陳述**優先**於較舊的概括。
- **display_name**：若**本輪**使用者**重新**自報希望怎麼稱呼，**以本輪**為準**覆寫**（不併存多個自稱）。

## 產出前自檢
- 每一段要寫入的字串，必須能在「你：」的原文中指認；**只**在「小晴：」出現的句子**一律刪除**；for_staff 的讚美/提問**僅**能使用者**自己**說過的。

## 欄位說明
- **display_name**：**只依「你：」本輪**——若使用者在**本輪****明確**說出希望被稱呼的姓名、暱稱、稱呼（如「叫我阿公」「我姓林」「就叫我美玲姐」則取**美玲姐**等），填**一個**精簡稱呼，供系統**寫入資料庫**；**若本輪沒有**、或僅有含糊語氣**不可**斷定，**必須**留**空字串**。**嚴禁**從「小晴：」的話推測、**嚴禁**與**你：**無關的臆測；**嚴禁**以「...」「…」刪節號或**僅**標點當佔位。
- **inferred**：與**真人**之關係/被照顧者、關心重點、情緒與壓力（不抄衛教條文）；**已**寫入 **display_name** 的專屬稱呼**不要**在 inferred 內**整段**重複羅列，**一句**帶過即可。
- **preferences**：飲食、興趣、想怎麼被溝通等。
- **traits**：性格、表達風格。
- **visit_context**：**是否今日到院**、**陪診或本人就診**、看了哪類門診/大致時段等（**僅**使用者有說或能合理推的；沒有則留空或略寫「尚未提及」）。
- **staff_interaction_satisfaction**（**與醫護／院方互動感受，滾動更新**）：
  - **每一輪**都須綜合「【既有】」與**至今**在「你：」中、與**醫師／護理／櫃台／院方／掛號看診體感**有關的**表達**，寫出**當下最完整、可讀的結論**（一句或多句均可）；**採用整段重寫、不要**只在上輪底下加一句、也**不要**讓新舊矛盾並存兩段。
  - 若本輪使用者**補充、加強、**或**改口**（比先前**更滿**或**不滿**、補敘櫃台/批價等），**必須**在欄內**改寫成最新整體觀感**；若與前說有出入，**以本輪與**較**新**的陳述**為優先**綜合。
  - 若**本輪**「你：」**完全**未觸及醫護／院方／櫃台／就醫體感，且「既有」**已有**實質內容：**維持與【既有】相同**字串，或**空字串**任擇一（**不要**寫佔位句，系統可沿用；**不要**在無新事實時**無故清空**既有結論)。
  - 若**從未**有相關敘述且本輪也無：空字串。
  - **僅**依「你：」**不可**從「小晴：」抄；**不可**用「尚未提及」「本輪未說」等佔位句**代替**實指內容。
- **for_staff**：轉述給醫護的今日摘要，三個子欄都須**只依使用者**：
  - **one_line**：一句話脈絡（誰、今日在院/陪診、最掛心的事，一句為限）。
  - **questions_asked**：**使用者向系統/或小晴問過的重點**（短列，**不要**抄整段衛教，不要**把小晴的長答當成使用者的讚美**）。
  - **praise_for_staff**：若**使用者有**稱讚、感謝**醫師/護理/醫療團隊**，或**對院方、櫃台、整體就醫服務／環境的正面評價**，摘錄此處；若使用者**點名**某位同仁（姓名、姓氏＋職稱如「林小陽護士」「謝醫師」），請**保留姓名／職稱與評語重點**，以利醫護端判斷是否為本人並口語轉述；**若沒有就留空字串。嚴禁**把小晴的客套、鼓勵語當成使用者的讚美**。

## 合併
- 你會看到「既有」各欄與**既有今日給醫護摘要**；**先**依上列「**新舊以新為準**」**消除矛盾**，再**去重、合併**；無新事實可微調贅字。**與醫護互動滿意度**一欄另須**隨**歷次「你：」**滾動**整理成**目前****最終**說法（見該欄條文）。

## 嚴格禁止
- 關係欄、情境欄，**絕對**不可出現「關係：小晴」或把小晴寫成被照顧者；**不可**把小晴的衛教長文、條列、摘要**當成**使用者的敘事寫入。

## 輸出（僅此 JSON、勿 markdown）
- **下例為結構示範**；內文請依本輪真實整理。**display_name 無則用 ""，禁止**刪節號「...」「…」佔位。
{"display_name":"","inferred":"擔心奶奶自理與用藥","preferences":"","traits":"","visit_context":"心臟內科回診","staff_interaction_satisfaction":"","for_staff":{"one_line":"家屬陪診、關心返家照護","questions_asked":"藥物注意","praise_for_staff":"很感謝林小陽護士的幫忙，她很細心"}}`;

type Triple = {
  inferred: string;
  preferences: string;
  traits: string;
  display_name: string;
};
type FullPack = Triple & {
  visit_context: string;
  staff_interaction_satisfaction: string;
  for_staff: StaffFeedRow;
};

function tryParseJsonTriple(raw: string): Triple | null {
  const t = raw.trim();
  if (!t) return null;
  const unwrapped = t
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = unwrapped.indexOf("{");
  const end = unwrapped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(unwrapped.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const pickStr = (k: string, k2?: string) => {
      const a = o[k];
      if (typeof a === "string" && a) return a;
      if (k2) {
        const b = o[k2];
        if (typeof b === "string" && b) return b;
      }
      return "";
    };
    const inferred = pickStr("inferred", "inferred_profile");
    const preferences = pickStr("preferences");
    const traits = pickStr("traits", "personality");
    const display_name = pickStr("display_name", "displayName");
    if (!inferred && !preferences && !traits && !display_name) return null;
    return { inferred, preferences, traits, display_name };
  } catch {
    return null;
  }
}

function parseForStaffField(o: Record<string, unknown> | null): StaffFeedRow {
  if (!o || typeof o !== "object")
    return { one_line: "", questions_asked: "", praise_for_staff: "" };
  const f = o as Record<string, unknown>;
  const s = (k: string) => (typeof f[k] === "string" ? f[k] : "");
  return {
    one_line: s("one_line") || s("oneLine") || s("line"),
    questions_asked: s("questions_asked") || s("questions"),
    praise_for_staff: s("praise_for_staff") || s("praise") || s("thanks"),
  };
}

function tryParseJsonFull(raw: string): FullPack | null {
  const t = raw.trim();
  if (!t) return null;
  const unwrapped = t
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = unwrapped.indexOf("{");
  const end = unwrapped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(unwrapped.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const pickStr = (k: string) =>
      typeof o[k] === "string" ? (o[k] as string) : "";
    const tri = {
      inferred: pickStr("inferred") || pickStr("inferred_profile"),
      preferences: pickStr("preferences"),
      traits: pickStr("traits") || pickStr("personality"),
      display_name: pickStr("display_name") || pickStr("displayName"),
    };
    const visit = pickStr("visit_context");
    const sat = pickStr("staff_interaction_satisfaction");
    const forStaff = parseForStaffField(
      (o.for_staff as Record<string, unknown>) ?? null
    );
    if (
      !tri.inferred &&
      !tri.preferences &&
      !tri.traits &&
      !visit &&
      !sat &&
      !forStaff.one_line &&
      !forStaff.questions_asked &&
      !forStaff.praise_for_staff &&
      !tri.display_name
    ) {
      return null;
    }
    return {
      ...tri,
      visit_context: visit,
      staff_interaction_satisfaction: sat,
      for_staff: forStaff,
    };
  } catch {
    return null;
  }
}

function sanitizeSplice(s: string, max: number): string {
  return s.replace(/\r\n/g, "\n").trim().slice(0, max);
}

function normOverlap(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

/** 小晴常見的衛教、勸導、套語（出現在內文且本輪使用者沒有說 → 丟棄） */
const ASSISTANT_PHRASING = /建議(與|和)(醫師|醫生|護理)|遵醫囑|參考(資料|文獻|上述|以下)|若症狀(持續|加劇|未改)|盡快(就醫|求診)|希望對(你|妳|您).{0,4}(有幫助|參考)|幫你(整理|釐清|整理一下)|有(沒有)?需要(幫|再跟我)|可(以)?(先|參考|與(醫師|醫生)討論)|幫(你|妳)帶(到|到醫院)|參考資訊|就醫引導/;

/**
 * 從**使用者畫像欄位**或 for_staff 字串中，刪去可判為複製自本輪「小晴」的句子；避免助理輸出進入長期記憶。
 */
export function stripAssistantEchoInField(
  value: string,
  userText: string,
  assistantText: string
): string {
  if (!value.trim()) return value;
  const u = normOverlap(userText);
  const a = normOverlap(assistantText);
  if (!a) return value;

  const n = value.replace(/\r\n/g, "\n").trim();
  if (n.length >= 25) {
    const probe = n.slice(0, Math.min(48, n.length));
    if (a.includes(probe) && !u.slice(0, Math.min(800, u.length)).includes(probe.slice(0, 22))) {
      return "";
    }
  }

  const segments = n.split(/(?<=[\n。！？])/);
  const kept: string[] = [];
  for (const seg of segments) {
    const p = seg.trim();
    if (!p) continue;
    if (p.length < 6) {
      kept.push(seg);
      continue;
    }
    if (u.includes(p)) {
      kept.push(seg);
      continue;
    }
    if (ASSISTANT_PHRASING.test(p) && !u.includes(p)) {
      continue;
    }
    if (p.length >= 12 && a.includes(p) && !u.includes(p)) {
      continue;
    }
    kept.push(seg);
  }
  return kept.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 若整段在 strip 後變空、但 model 有輸出內容 = 幾乎皆為小晴迴聲，則**保留**資料庫既有值、避免清空畫像。
 */
function coalesceStripped(
  modelIncoming: string,
  stripped: string,
  previousFromDb: string
): string {
  const s = stripped.trim();
  if (s.length > 0) return s;
  if (modelIncoming.trim().length > 0) return (previousFromDb ?? "").trim();
  return (previousFromDb ?? "").trim();
}

/**
 * 寫庫用：有**有效新稿**就覆寫；若新稿是空／佔位，**保留**庫內舊的實質內容，避免只更新一次後被佔位句清空。
 */
function resolveStaffInteractionSatisfactionForDb(
  merged: string,
  previousFromDb: string
): string {
  const prev = (previousFromDb ?? "").replace(/\r\n/g, "\n").trim();
  const candidate = (merged ?? "").replace(/\r\n/g, "\n").trim();
  if (candidate.length > 0 && !isPlaceholderStaffSatisfaction(candidate)) {
    return candidate.slice(0, MAX_SAT);
  }
  if (prev.length > 0 && !isPlaceholderStaffSatisfaction(prev)) {
    return prev.slice(0, MAX_SAT);
  }
  return "";
}

export async function mergeInferredProfileFromTurn(
  supabase: SupabaseClient,
  userKey: string,
  userRole: UserRole,
  userText: string,
  assistantText: string
): Promise<void> {
  if (process.env.CAREPAL_DISABLE_PROFILE_INFER?.trim() === "1") return;

  const llm = createChatLlm();
  if (!llm) return;

  await getOrCreateProfile(supabase, userKey, userRole);

  if (userRole === "staff") {
    const { data: row, error: selErr } = await supabase
      .from("carepal_profiles")
      .select("inferred_profile, preferences, traits, display_name")
      .eq("user_key", userKey)
      .eq("user_role", userRole)
      .maybeSingle();
    if (selErr) throw selErr;
    const r = (row as {
      inferred_profile?: string;
      preferences?: string;
      traits?: string;
      display_name?: string;
    } | null) ?? { inferred_profile: "", preferences: "", traits: "", display_name: "" };
    const prevI =
      (r.inferred_profile ?? "").trim() || "（尚無。請從本輪建立。）";
    const prevP = (r.preferences ?? "").trim() || "（尚無。）";
    const prevT = (r.traits ?? "").trim() || "（尚無。）";
    const userContent = `【既有－照護畫像 inferred】
${prevI}

【既有－偏好 preferences】
${prevP}

【既有－風格 traits】
${prevT}

【本輪對話】
你：${userText.slice(0, MAX_IN_USER)}
小晴：${assistantText.slice(0, MAX_IN_ASST)}`.trim();

    const inferModel =
      process.env.CAREPAL_PROFILE_INFER_MODEL?.trim() || llm.model;
    const completion = await llm.client.chat.completions.create({
      model: inferModel,
      messages: [
        { role: "system", content: SYSTEM_TRIPLE },
        { role: "user", content: userContent },
      ],
      max_tokens: 1200,
      temperature: 0.15,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = tryParseJsonTriple(raw) ?? null;
    if (!parsed) {
      console.error(
        "[carepal] profile-infer staff: invalid JSON, raw=",
        raw.slice(0, 400)
      );
      return;
    }
    const rawI = (r.inferred_profile ?? "").trim();
    const rawP = (r.preferences ?? "").trim();
    const rawT = (r.traits ?? "").trim();
    const next = {
      inferred: coalesceStripped(
        parsed.inferred,
        stripAssistantEchoInField(
          sanitizeSplice(parsed.inferred, MAX_INFERRED),
          userText,
          assistantText
        ),
        rawI
      ),
      preferences: coalesceStripped(
        parsed.preferences,
        stripAssistantEchoInField(
          sanitizeSplice(parsed.preferences, MAX_PREF),
          userText,
          assistantText
        ),
        rawP
      ),
      traits: coalesceStripped(
        parsed.traits,
        stripAssistantEchoInField(
          sanitizeSplice(parsed.traits, MAX_TRAITS),
          userText,
          assistantText
        ),
        rawT
      ),
    };
    let disp = sanitizeDisplayName(parsed.display_name ?? "");
    const uN = normOverlap(userText);
    const aN = normOverlap(assistantText);
    if (disp && aN.includes(disp) && !uN.includes(disp)) disp = "";
    if (!next.inferred && !next.preferences && !next.traits && !disp) return;
    const { error: upErr } = await supabase
      .from("carepal_profiles")
      .update({
        inferred_profile: next.inferred,
        preferences: next.preferences,
        traits: next.traits,
        ...(disp ? { display_name: disp } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("user_key", userKey)
      .eq("user_role", userRole);
    if (upErr) throw upErr;
    return;
  }

  const d = todayDateTaipei();
  const { data: row, error: selErr } = await supabase
    .from("carepal_profiles")
    .select(
      "inferred_profile, preferences, traits, visit_context, staff_interaction_satisfaction"
    )
    .eq("user_key", userKey)
    .eq("user_role", userRole)
    .maybeSingle();
  if (selErr) throw selErr;

  const { data: feedRow } = await supabase
    .from("carepal_staff_feed")
    .select("one_line, questions_asked, praise_for_staff")
    .eq("contributor_key", userKey)
    .eq("contributor_role", userRole)
    .eq("signal_date", d)
    .maybeSingle();

  const r = (row as {
    inferred_profile?: string;
    preferences?: string;
    traits?: string;
    visit_context?: string;
    staff_interaction_satisfaction?: string;
  } | null) ?? {
    inferred_profile: "",
    preferences: "",
    traits: "",
    visit_context: "",
    staff_interaction_satisfaction: "",
  };

  const f = (feedRow as {
    one_line?: string;
    questions_asked?: string;
    praise_for_staff?: string;
  } | null) ?? { one_line: "", questions_asked: "", praise_for_staff: "" };

  const prevI =
    (r.inferred_profile ?? "").trim() || "（尚無。請從本輪建立。）";
  const prevP = (r.preferences ?? "").trim() || "（尚無。）";
  const prevT = (r.traits ?? "").trim() || "（尚無。）";
  const prevV = (r.visit_context ?? "").trim() || "（尚無。）";
  const prevS = (r.staff_interaction_satisfaction ?? "").trim() || "（尚無。）";
  const prevFeed = `one_line: ${(f.one_line ?? "").trim() || "—"}
questions_asked: ${(f.questions_asked ?? "").trim() || "—"}
praise_for_staff: ${(f.praise_for_staff ?? "").trim() || "—"}`;

  const userContent = `【既有－照護畫像 inferred】
${prevI}

【既有－偏好】
${prevP}

【既有－風格】
${prevT}

【既有－到院/陪診情境】
${prevV}

【既有－與醫護互動滿意度】
${prevS}

【既有今日給醫護的摘要（若尚無可略）】
${prevFeed}

【本輪對話】
你：${userText.slice(0, MAX_IN_USER)}
小晴：${assistantText.slice(0, MAX_IN_ASST)}`.trim();

  const inferModel =
    process.env.CAREPAL_PROFILE_INFER_MODEL?.trim() || llm.model;
  const completion = await llm.client.chat.completions.create({
    model: inferModel,
    messages: [
      { role: "system", content: SYSTEM_FAMILY_PATIENT },
      { role: "user", content: userContent },
    ],
    max_tokens: 1600,
    temperature: 0.15,
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  const parsed = tryParseJsonFull(raw) ?? null;
  if (!parsed) {
    console.error(
      "[carepal] profile-infer: invalid or empty JSON, raw=",
      raw.slice(0, 500)
    );
    return;
  }

  const rI = (r.inferred_profile ?? "").trim();
  const rP = (r.preferences ?? "").trim();
  const rT = (r.traits ?? "").trim();
  const rV = (r.visit_context ?? "").trim();
  const rS = (r.staff_interaction_satisfaction ?? "").trim();
  const next = {
    inferred: coalesceStripped(
      parsed.inferred,
      stripAssistantEchoInField(
        sanitizeSplice(parsed.inferred, MAX_INFERRED),
        userText,
        assistantText
      ),
      rI
    ),
    preferences: coalesceStripped(
      parsed.preferences,
      stripAssistantEchoInField(
        sanitizeSplice(parsed.preferences, MAX_PREF),
        userText,
        assistantText
      ),
      rP
    ),
    traits: coalesceStripped(
      parsed.traits,
      stripAssistantEchoInField(
        sanitizeSplice(parsed.traits, MAX_TRAITS),
        userText,
        assistantText
      ),
      rT
    ),
    visit_context: coalesceStripped(
      parsed.visit_context,
      stripAssistantEchoInField(
        sanitizeSplice(parsed.visit_context, MAX_VISIT),
        userText,
        assistantText
      ),
      rV
    ),
    sat: coalesceStripped(
      parsed.staff_interaction_satisfaction,
      stripAssistantEchoInField(
        sanitizeSplice(parsed.staff_interaction_satisfaction, MAX_SAT),
        userText,
        assistantText
      ),
      rS
    ),
  };
  let disp = sanitizeDisplayName(parsed.display_name ?? "");
  {
    const uN = normOverlap(userText);
    const aN = normOverlap(assistantText);
    if (disp && aN.includes(disp) && !uN.includes(disp)) disp = "";
  }

  const satForDb = resolveStaffInteractionSatisfactionForDb(next.sat, rS);

  const { error: upErr } = await supabase
    .from("carepal_profiles")
    .update({
      inferred_profile: next.inferred,
      preferences: next.preferences,
      traits: next.traits,
      visit_context: next.visit_context,
      staff_interaction_satisfaction: satForDb,
      ...(disp ? { display_name: disp } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("user_key", userKey)
    .eq("user_role", userRole);
  if (upErr) throw upErr;

  const ur = userRole;
  if (ur === "family" || ur === "patient") {
    const { data: nameRow, error: nameErr } = await supabase
      .from("carepal_profiles")
      .select("display_name")
      .eq("user_key", userKey)
      .eq("user_role", userRole)
      .maybeSingle();
    if (nameErr) throw nameErr;
    const nameForFeed = sanitizeDisplayName(
      String((nameRow as { display_name?: string } | null)?.display_name ?? "")
    );
    const fO = (f.one_line ?? "").trim();
    const fQ = (f.questions_asked ?? "").trim();
    const fP = (f.praise_for_staff ?? "").trim();
    const inO = parsed.for_staff?.one_line ?? "";
    const inQ = parsed.for_staff?.questions_asked ?? "";
    const inP = parsed.for_staff?.praise_for_staff ?? "";
    await upsertTodayStaffFeed(supabase, userKey, ur, {
      one_line: coalesceStripped(
        inO,
        stripAssistantEchoInField(
          sanitizeSplice(inO, 500),
          userText,
          assistantText
        ),
        fO
      ),
      questions_asked: coalesceStripped(
        inQ,
        stripAssistantEchoInField(
          sanitizeSplice(inQ, 1200),
          userText,
          assistantText
        ),
        fQ
      ),
      praise_for_staff: coalesceStripped(
        inP,
        stripAssistantEchoInField(
          sanitizeSplice(inP, 800),
          userText,
          assistantText
        ),
        fP
      ),
      ...(nameForFeed ? { contributor_display_name: nameForFeed } : {}),
    });
  }
}
