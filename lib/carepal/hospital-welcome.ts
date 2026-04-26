import type { UserRole } from "@/lib/carepal/user-role";

/**
 * 首次開啟對話的招呼。先**簡短引導**失智照護相關可談，**主問仍僅**稱呼一句；其餘到院、陪診等見人設／audience。
 */
export function initialAssistantWelcome(role: UserRole): string {
  if (role === "family")
    return "嗨，我是小晴。我是醫院裡的小助手，你好呀~ 有關失智症或照顧上的困擾、疑問，也都可以問我，我會盡力陪你釐清。先問一下：方便怎麼稱呼你？";
  if (role === "patient")
    return "嗨，我是小晴。我是醫院裡的智能助手，很高興遇到你~ 有關失智症或照顧、身體上的疑問，想聊的都可以問我，我會盡力回答。請問怎麼稱呼你？";
  return "嗨，我是小晴。我是大家的小助理師妹，很高興遇見你! 今天一切都順利嗎?";
}
