import type { UserRole } from "@/lib/carepal/user-role";
import type { LocalProfileSnapshot } from "@/lib/carepal/local-profile";
import {
  formatProactiveTipLead,
  pickProactiveCareTipForVariety,
  proactiveCareTipLeadForRole,
} from "@/lib/carepal/proactive-care-tips";

const GUEST = "訪客";
const MAX_NAME = 20;

export type WelcomeOptions = {
  /** RAG 摘錄正文（不含前綴）；有值且有長度則優先於靜態題庫 */
  ragTipExcerpt?: string | null;
  /** 每次開啟對話傳入不同字串，靜態小錦囊也會換題（與 RAG nonce 可同一值） */
  tipVarietyKey?: string;
};

function trimName(raw: string): string {
  const s = raw.trim();
  if (!s || s === GUEST) return "";
  return s.length > MAX_NAME ? s.slice(0, MAX_NAME) : s;
}

/** 稱呼以外是否已有可辨識的畫像／記憶脈絡 */
function hasProfileContext(p: LocalProfileSnapshot): boolean {
  const parts = [
    p.inferred_profile,
    p.family_notes,
    p.mood_note,
    p.preferences,
    p.traits,
    p.visit_context,
    p.staff_interaction_satisfaction,
    ...p.memory_lines.map((l) => l.content),
  ];
  return parts.some((s) => s.trim().length > 0);
}

function visitorTipBlock(role: UserRole, opts?: WelcomeOptions): string {
  if (role !== "family" && role !== "patient") return "";
  const ex = opts?.ragTipExcerpt?.trim();
  if (ex) {
    const lead = formatProactiveTipLead(role, ex);
    return lead ? `${lead} ` : "";
  }
  const key = opts?.tipVarietyKey?.trim();
  if (key) {
    const body = pickProactiveCareTipForVariety(role, key);
    const lead = formatProactiveTipLead(role, body);
    return lead ? `${lead} ` : "";
  }
  const tip = proactiveCareTipLeadForRole(role);
  return tip ? `${tip} ` : "";
}

/**
 * 首次開啟對話的招呼。若畫像已有稱呼或長期內容，則不追問稱呼，改以稱呼問候今日狀況；否則保留首次引導與稱呼一句。
 */
export function initialAssistantWelcome(
  role: UserRole,
  profile: LocalProfileSnapshot,
  opts?: WelcomeOptions
): string {
  const name = trimName(profile.display_name);
  const remembered = name.length > 0 || hasProfileContext(profile);

  if (role === "family") {
    const tipBlock = visitorTipBlock("family", opts).trimEnd();
    if (name) {
      const greeting = `嗨，我是小晴～${name}，你好呀～又見面了。`;
      const closing = `今天自己或家人還好嗎？照顧上想聊的儘管說。`;
      return [greeting, tipBlock || undefined, closing]
        .filter(Boolean)
        .join("\n\n");
    }
    if (remembered) {
      return `嗨，我是小晴～又見面了～${tipBlock}今天狀況怎麼樣？失智症或照顧想聊的都可以丟給我，我陪你釐清。`;
    }
    return `嗨，我是小晴～醫院裡陪你聊照顧的小助手，你好呀～有失智症或照顧上的困擾、疑問，也都可以隨時問我哦~! ${tipBlock}先問一下：方便怎麼稱呼你？`;
  }

  if (role === "patient") {
    const tipBlock = visitorTipBlock("patient", opts);
    if (name) {
      return `嗨，我是小晴～${name}，你好～又見面了。${tipBlock}今天身體或心情還好嗎？想問的儘管說。`;
    }
    if (remembered) {
      return `嗨，我是小晴～又見面了～${tipBlock}今天想從哪方面聊？記憶、行動或身體有疑問，我盡力用短話幫你整理。`;
    }
    return `嗨，我是小晴～在醫院裡陪你問問答答的小助手，很高興遇到你～記憶、行動或身體有疑問想聊都可以。${tipBlock}請問怎麼稱呼你？`;
  }

  if (name) {
    return `嗨，我是小晴～${name}，你好～又見面了。今天臨床或團隊還順利嗎？想整理或吐槽幾句，我也在最後一排幫你聽著。`;
  }
  if (remembered) {
    return "嗨，我是小晴～又見面了～今天還順利嗎？想記重點或純聊天，都可以跟我說。";
  }
  return "嗨，我是小晴～算大家的小助理師妹，在這陪你們喘口氣～很高興遇見你，今天一切都還順利嗎？";
}
