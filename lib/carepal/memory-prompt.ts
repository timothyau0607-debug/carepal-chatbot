import type { UserRole } from "@/lib/carepal/user-role";

export type ProfileForPrompt = {
  display_name: string;
  family_notes: string;
  mood_note: string;
  /** 從多輪對話歸納的穩定畫像（系統以 LLM 更新） */
  inferred_profile: string;
  /** 手動：偏好、飲食、溝通習慣等 */
  preferences: string;
  /** 手動：性格、表達風格等 */
  traits: string;
  /** 今日到院／陪診等（歸納＋可手改） */
  visit_context: string;
  /** 與醫護互動滿意度（歸納＋可手改） */
  staff_interaction_satisfaction: string;
};

export type MemoryLine = { content: string };

function memoryHeaderForRole(role: UserRole): string {
  const roleHint =
    role === "family"
      ? "家屬或照顧者脈絡"
      : role === "patient"
        ? "患者本人脈絡"
        : "專業團隊成員脈絡";
  return `【關於此使用者的已記得資訊（${roleHint}；勿與參考資料混淆；就醫相關仍請引導遵醫囑）】`;
}

function familyNotesLabel(role: UserRole): string {
  if (role === "family") return "家屬曾提過：";
  if (role === "patient") return "曾提到或在意的事：";
  return "臨床／溝通上留意點：";
}

export function formatLongTermMemoryForPrompt(
  profile: ProfileForPrompt,
  lines: MemoryLine[],
  userRole: UserRole = "family"
): string {
  const parts: string[] = [
    memoryHeaderForRole(userRole),
    `稱呼或識別：${profile.display_name.trim() || "訪客"}`,
  ];
  if (profile.inferred_profile.trim()) {
    parts.push(
      `從互動歸納的用戶畫像（長期、已整理）：\n${profile.inferred_profile.trim()}`
    );
  }
  if (profile.preferences.trim()) {
    parts.push(
      `偏好、生活與溝通習慣（使用者提供）：\n${profile.preferences.trim()}`
    );
  }
  if (profile.traits.trim()) {
    parts.push(`性格與表達風格（使用者提供）：\n${profile.traits.trim()}`);
  }
  if (profile.visit_context.trim()) {
    parts.push(
      `到院／陪診情境（由對話歸納或手填）：\n${profile.visit_context.trim()}`
    );
  }
  if (profile.staff_interaction_satisfaction.trim()) {
    parts.push(
      `與醫護互動感受（由對話歸納或手填）：\n${profile.staff_interaction_satisfaction.trim()}`
    );
  }
  if (profile.family_notes.trim()) {
    parts.push(`${familyNotesLabel(userRole)}${profile.family_notes.trim()}`);
  }
  if (profile.mood_note.trim()) {
    parts.push(`情緒或觀察：${profile.mood_note.trim()}`);
  }
  if (lines.length > 0) {
    const bullet = lines
      .map((l) => l.content.trim())
      .filter(Boolean)
      .map((c) => `— ${c}`)
      .join("\n");
    if (bullet) parts.push("其他已記下的事項：\n" + bullet);
  }
  return parts.join("\n");
}
