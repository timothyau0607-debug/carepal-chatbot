import type { UserRole } from "@/lib/carepal/user-role";
import {
  formatLongTermMemoryForPrompt,
  type MemoryLine,
} from "@/lib/carepal/memory-prompt";

const V = "carepal_local_profile_v1";

export type LocalProfileSnapshot = {
  display_name: string;
  family_notes: string;
  mood_note: string;
  /** 本機可自填；雲端時亦會自伺服器讀寫，與雲端 inferred_profile 對應 */
  inferred_profile: string;
  preferences: string;
  traits: string;
  visit_context: string;
  staff_interaction_satisfaction: string;
  memory_lines: { content: string }[];
};

function key(userKey: string, userRole: string): string {
  return `${V}::${userKey}::${userRole}`;
}

export function readLocalProfile(
  userKey: string,
  userRole: UserRole
): LocalProfileSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(userKey, userRole));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LocalProfileSnapshot>;
    if (typeof p.display_name !== "string") return null;
    const lines = Array.isArray(p.memory_lines)
      ? p.memory_lines.map((x) =>
          typeof x === "string"
            ? { content: x }
            : { content: String((x as { content?: string }).content ?? "") }
        )
      : [];
    return {
      display_name: p.display_name,
      family_notes: typeof p.family_notes === "string" ? p.family_notes : "",
      mood_note: typeof p.mood_note === "string" ? p.mood_note : "",
      inferred_profile:
        typeof p.inferred_profile === "string" ? p.inferred_profile : "",
      preferences: typeof p.preferences === "string" ? p.preferences : "",
      traits: typeof p.traits === "string" ? p.traits : "",
      visit_context:
        typeof p.visit_context === "string" ? p.visit_context : "",
      staff_interaction_satisfaction:
        typeof p.staff_interaction_satisfaction === "string"
          ? p.staff_interaction_satisfaction
          : "",
      memory_lines: lines,
    };
  } catch {
    return null;
  }
}

export function writeLocalProfile(
  userKey: string,
  userRole: UserRole,
  s: LocalProfileSnapshot
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key(userKey, userRole), JSON.stringify(s));
}

/** 供沒有雲端長期記憶時，併入 system 提示。 */
export function formatLocalProfileForSystemPrompt(
  s: LocalProfileSnapshot,
  userRole: UserRole
): string {
  const has =
    s.display_name.trim() ||
    s.family_notes.trim() ||
    s.mood_note.trim() ||
    s.inferred_profile.trim() ||
    s.preferences.trim() ||
    s.traits.trim() ||
    s.visit_context.trim() ||
    s.staff_interaction_satisfaction.trim() ||
    s.memory_lines.length > 0;
  if (!has) return "";
  const lines: MemoryLine[] = s.memory_lines;
  const inner = formatLongTermMemoryForPrompt(
    {
      display_name: s.display_name || "訪客",
      family_notes: s.family_notes,
      mood_note: s.mood_note,
      inferred_profile: s.inferred_profile,
      preferences: s.preferences,
      traits: s.traits,
      visit_context: s.visit_context,
      staff_interaction_satisfaction: s.staff_interaction_satisfaction,
    },
    lines,
    userRole
  );
  return "【本機瀏覽器暫存畫像（雲端未同步時仍會帶入對話）】\n" + inner;
}
