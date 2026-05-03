import type { UserRole } from "@/lib/carepal/user-role";
import { hasRecordedStaffSatisfactionInPrompt } from "@/lib/carepal/visit-staff-nudge";

export type Msg = { role: string; content: string };

const MIN_USER_MESSAGES_BEFORE_CHEER = 5;
const MIN_USER_TURNS_BETWEEN_CHEER = 14;

/** 僅對家屬／病友；對醫護、院務帶強烈不信任或對立時不顯示打氣 UI。 */
function userBubbleLooksClearlyNegative(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/想(不開|死)|活不下去|不想活|自殘|結束這一切/.test(t)) return true;
  if (/投訴|申訴|醫糾|客訴|媒體|^告.{0,2}(他|醫)|衛福局/.test(t)) return true;
  if (
    /醫護|護理|護士|醫師|櫃台|院方|批次|檢驗|批價|掛號/.test(t) &&
    /(態度)?.{0,4}(很差|超差|離譜|垃圾|混蛋|畜生|推卸|冷血|愛理不理|敷衍|不尊重|瞧不起|騙錢)|很(不爽|不甘願)|生氣|火大/.test(t)
  ) {
    return true;
  }
  if (
    /(受夠了|受不了了).{0,12}(醫院|院方|護理|醫師|護士|護理師|這裡)|再也不要來|爛透|素質低落/.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

function recentUserMessages(
  messages: Msg[],
  maxTurns: number
): readonly string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < maxTurns; i--) {
    const m = messages[i];
    if (m?.role === "user" && typeof m.content === "string") {
      out.push(m.content);
    }
  }
  return out;
}

/**
 * 本輪是否在 UI 附上「替醫護打氣／按讚」區塊（客戶端以 lastStaffCheerOfferUserCount 節流）。
 */
export function shouldOfferStaffCheerBanner(params: {
  userRole: UserRole;
  userMessageCount: number;
  messages: Msg[];
  useCloudMemory: boolean;
  memoryForPrompt: string;
  clientProfile?: {
    staff_interaction_satisfaction?: string;
  } | null;
  lastStaffCheerOfferUserCount?: number;
}): boolean {
  if (params.userRole !== "family" && params.userRole !== "patient")
    return false;
  if (params.userMessageCount < MIN_USER_MESSAGES_BEFORE_CHEER) return false;

  if (
    hasRecordedStaffSatisfactionInPrompt(
      params.useCloudMemory,
      params.memoryForPrompt,
      params.clientProfile
    )
  ) {
    return false;
  }

  const lastMsgs = recentUserMessages(params.messages, 5);
  if (lastMsgs.some((t) => userBubbleLooksClearlyNegative(t))) {
    return false;
  }

  const lastStaff = params.lastStaffCheerOfferUserCount ?? 0;
  if (
    lastStaff > 0 &&
    params.userMessageCount - lastStaff < MIN_USER_TURNS_BETWEEN_CHEER
  ) {
    return false;
  }

  return true;
}

/**
 * 請模型口頭邀請對方使用訊息下方圖樣並鼓勵留言；僅在上述條件通過後注入。
 */
export const STAFF_CHEER_UI_SYSTEM_HINT =
  `【本輪｜輕量搭配介面】若對方口吻**不是**強烈不愉快，且你**主旨已經接住**，可在**同一則最末再加 1～2 句**，口語請對主：若在院內心裡有想替醫護**打氣**或**默默按個讚**的念頭，可以看看**這則小晴下面的兩個圖符**示意一下；若想多說幾句對團隊的感謝，也歡迎**直接打在對話輸入框**傳你—強調量力、**沒有任何壓力**，不講也完全沒關係。**不要**用行政或蒐資料口吻。**不要**複述與你到院／櫃台那串長問卷式關心力拼在同一段講很多次。`;

