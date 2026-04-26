import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/carepal/user-role";
import {
  formatLongTermMemoryForPrompt,
  type MemoryLine,
  type ProfileForPrompt,
} from "@/lib/carepal/memory-prompt";

type ProfileRow = {
  user_key: string;
  user_role: string;
  display_name: string;
  family_notes: string;
  mood_note: string;
  inferred_profile: string;
  preferences: string;
  traits: string;
  visit_context: string;
  staff_interaction_satisfaction: string;
  created_at: string;
  updated_at: string;
};

const DEFAULTS: ProfileForPrompt = {
  display_name: "訪客",
  family_notes: "",
  mood_note: "",
  inferred_profile: "",
  preferences: "",
  traits: "",
  visit_context: "",
  staff_interaction_satisfaction: "",
};

const PROFILE_CONFLICT = "user_key,user_role" as const;

/** 手動條目用 note；chat_turn 不併入 LLM 長期條列，僅寫庫保存對話稽核用 */
const KIND_CHAT_TURN = "chat_turn" as const;

export async function getOrCreateProfile(
  supabase: SupabaseClient,
  userKey: string,
  userRole: UserRole
): Promise<ProfileForPrompt> {
  const { error: upErr } = await supabase.from("carepal_profiles").upsert(
    { user_key: userKey, user_role: userRole },
    { onConflict: PROFILE_CONFLICT, ignoreDuplicates: true }
  );
  if (upErr) throw upErr;
  const { data: row, error: selErr } = await supabase
    .from("carepal_profiles")
    .select(
      "display_name, family_notes, mood_note, inferred_profile, preferences, traits, visit_context, staff_interaction_satisfaction"
    )
    .eq("user_key", userKey)
    .eq("user_role", userRole)
    .single();
  if (selErr) throw selErr;
  return {
    display_name: row?.display_name ?? DEFAULTS.display_name,
    family_notes: row?.family_notes ?? "",
    mood_note: row?.mood_note ?? "",
    inferred_profile: row?.inferred_profile ?? DEFAULTS.inferred_profile,
    preferences: row?.preferences ?? DEFAULTS.preferences,
    traits: row?.traits ?? DEFAULTS.traits,
    visit_context: row?.visit_context ?? DEFAULTS.visit_context,
    staff_interaction_satisfaction:
      row?.staff_interaction_satisfaction ??
      DEFAULTS.staff_interaction_satisfaction,
  };
}

export async function fetchProfileRow(
  supabase: SupabaseClient,
  userKey: string,
  userRole: UserRole
): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("carepal_profiles")
    .select(
      "user_key, user_role, display_name, family_notes, mood_note, inferred_profile, preferences, traits, visit_context, staff_interaction_satisfaction, created_at, updated_at"
    )
    .eq("user_key", userKey)
    .eq("user_role", userRole)
    .maybeSingle();
  if (error) throw error;
  return data as ProfileRow | null;
}

export async function fetchMemoryLines(
  supabase: SupabaseClient,
  userKey: string,
  userRole: UserRole,
  limit = 20
): Promise<MemoryLine[]> {
  const { data, error } = await supabase
    .from("carepal_memory_entries")
    .select("content, kind")
    .eq("user_key", userKey)
    .eq("user_role", userRole)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw error;
  const rows = (data ?? []).filter(
    (r) => (r as { kind?: string }).kind !== KIND_CHAT_TURN
  );
  return rows
    .slice(0, limit)
    .reverse()
    .map((r) => ({ content: r.content as string }));
}

export async function buildLongTermSystemBlock(
  supabase: SupabaseClient,
  userKey: string,
  userRole: UserRole
): Promise<string> {
  const profile = await getOrCreateProfile(supabase, userKey, userRole);
  const lines = await fetchMemoryLines(supabase, userKey, userRole);
  return formatLongTermMemoryForPrompt(profile, lines, userRole);
}

const MAX_USER_SNIP = 800;
const MAX_REPLY_SNIP = 1200;

/**
 * 將一輪對話寫入 carepal_memory_entries（kind=chat_turn），
 * 僅作資料庫留存；併入 prompt 的條目仍僅手動 kind=note 等。
 */
export async function appendChatTurn(
  supabase: SupabaseClient,
  userKey: string,
  userRole: UserRole,
  userText: string,
  assistantText: string
): Promise<void> {
  const u = userText.slice(0, MAX_USER_SNIP);
  const a = assistantText.slice(0, MAX_REPLY_SNIP);
  const content = `你：${u}\n小晴：${a}`;
  await getOrCreateProfile(supabase, userKey, userRole);
  const { error } = await supabase.from("carepal_memory_entries").insert({
    user_key: userKey,
    user_role: userRole,
    content,
    kind: KIND_CHAT_TURN,
  });
  if (error) throw error;
}
