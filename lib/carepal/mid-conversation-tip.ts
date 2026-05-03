import {
  isSubstantiveDementiaCareQuestion,
  wantsInformationalDepth,
} from "@/lib/carepal/substantive-care-question";
import type { UserRole } from "@/lib/carepal/user-role";

const MIN_USER_MESSAGES_BEFORE_MID_TIP = 3;
/** 與上次中段小錦囊至少相隔幾則使用者訊息（僅計入使用者回合） */
const MIN_USER_TURNS_BETWEEN_MID_TIPS = 3;

/** 是否在自報稱呼（避免誤判成閒聊而塞小錦囊） */
function looksLikeNameIntro(userText: string): boolean {
  const t = userText.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return /^(我(叫|是)|可以叫我|請叫我|稱呼我|小姓|敝姓|名字(是|叫)|敝姓)/.test(
    t
  );
}

/**
 * 本輪是否偏閒聊、沒有具體照護／失智提問（適合自然帶一則小錦囊）。
 */
export function isCasualOrLightCareTurn(userText: string): boolean {
  const t = userText.replace(/\s+/g, " ").trim();
  if (t.length < 1) return false;
  if (looksLikeNameIntro(t)) return false;
  if (isSubstantiveDementiaCareQuestion(t)) return false;
  if (wantsInformationalDepth(t)) return false;

  if (/[？?]/.test(t)) {
    if (
      /怎(麼|樣)|如何|什麼|為什麼|為何|要不要|能不能|該不該|注意|建議|哪裡|哪種|哪些|可以嗎|要帶/.test(
        t
      )
    ) {
      return false;
    }
  }

  if (
    /^(謝謝|感謝|好的|好呀|好喔|嗯|嗯嗯|了解|知道|沒事|還好|還行|普通|還不錯|隨便|聊聊|在嗎|哈囉|嗨|你好|早安|午安|晚安|早|晚安啦|哈哈|呵呵|对对|對對|就是啊|是啊|沒什麼|不知道聊|隨便你)/.test(
      t
    )
  ) {
    return true;
  }

  if (t.length <= 18 && !/[？?什怎哪為該要不要能]/.test(t)) return true;

  if (
    /(聊聊天|說說話|陪陪我|有點無聊|心裡悶|有點煩|還可以啦|馬馬虎虎)/.test(t) &&
    t.length < 80
  ) {
    return true;
  }

  return false;
}

export function shouldOfferMidConversationTip(params: {
  userRole: UserRole;
  userMessageCount: number;
  lastUserText: string;
  longFormCare: boolean;
  lastProactiveTipUserCount?: number;
}): boolean {
  if (params.userRole !== "family" && params.userRole !== "patient")
    return false;
  if (params.userMessageCount < MIN_USER_MESSAGES_BEFORE_MID_TIP) return false;
  if (params.longFormCare) return false;
  if (!isCasualOrLightCareTurn(params.lastUserText)) return false;

  const lastMid = params.lastProactiveTipUserCount ?? 0;
  if (
    lastMid > 0 &&
    params.userMessageCount - lastMid < MIN_USER_TURNS_BETWEEN_MID_TIPS
  ) {
    return false;
  }

  return true;
}

export function buildMidConversationTipSystemBlock(params: {
  role: "family" | "patient";
  excerpt: string;
}): string {
  const label = "照顧者小錦囊";
  const e = params.excerpt
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
  return [
    `【本輪—可選${label}】使用者本輪**偏閒聊、沒有具體照護或失智相關提問**。請**先**同理、接住對方一句，再在**適當轉折**處**口語、簡短**帶一則新的「${label}」（下附摘錄；一至三句即可）。**不要**像播報列表或打斷對方情緒主軸；**不要**硬稱「這是第二個錦囊」。摘錄僅供參考，緊急或個別狀況仍應就醫。`,
    `摘錄：${e}`,
  ].join("\n");
}
