import type { UserRole } from "@/lib/carepal/user-role";
import type { LocalProfileSnapshot } from "@/lib/carepal/local-profile";

const GUEST = "訪客";
const MAX_NAME = 20;

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

/**
 * 首次開啟對話的招呼。若畫像已有稱呼或長期內容，則不追問稱呼，改以稱呼問候今日狀況；否則保留首次引導與稱呼一句。
 */
export function initialAssistantWelcome(
  role: UserRole,
  profile: LocalProfileSnapshot
): string {
  const name = trimName(profile.display_name);
  const remembered = name.length > 0 || hasProfileContext(profile);

  if (role === "family") {
    if (name) {
      return `嗨，我是小晴。${name}，你好呀~ 又見面了。今天自己或家人的狀況還好嗎？有照顧上想聊的，儘管跟我說。`;
    }
    if (remembered) {
      return "嗨，我是小晴。又見面了~ 今天狀況怎麼樣？有關失智症或照顧想聊的，都可以跟我說，我會盡力陪你釐清。";
    }
    return "嗨，我是小晴。我是醫院裡的小助手，你好呀~ 有關失智症或照顧上的困擾、疑問，也都可以問我，我會盡力陪你釐清。先問一下：方便怎麼稱呼你？";
  }

  if (role === "patient") {
    if (name) {
      return `嗨，我是小晴。${name}，你好~ 又見面了。今天身體或心情還好嗎？有想問的儘管跟我說。`;
    }
    if (remembered) {
      return "嗨，我是小晴。又見面了~ 今天想從哪方面聊？有關失智症、照顧或身體的疑問，我會盡力回答。";
    }
    return "嗨，我是小晴。我是醫院裡的智能助手，很高興遇到你~ 有關失智症或照顧、身體上的疑問，想聊的都可以問我，我會盡力回答。請問怎麼稱呼你？";
  }

  if (name) {
    return `嗨，我是小晴。${name}，你好~ 又見面了。今天臨床或團隊這邊還順利嗎？有需要我幫忙整理或提醒的，都可以說。`;
  }
  if (remembered) {
    return "嗨，我是小晴。又見面了~ 今天一切還順利嗎？有想記下的重點或想聊的，都可以跟我說。";
  }
  return "嗨，我是小晴。我是大家的小助理師妹，很高興遇見你! 今天一切都順利嗎?";
}
