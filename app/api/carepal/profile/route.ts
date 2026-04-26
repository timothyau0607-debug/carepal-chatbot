import { NextResponse } from "next/server";
import { isValidUserKey } from "@/lib/carepal/user-key";
import { parseUserRole } from "@/lib/carepal/user-role";
import {
  fetchMemoryLines,
  fetchProfileRow,
  getOrCreateProfile,
} from "@/lib/carepal/memory-store";
import { sanitizeDisplayName } from "@/lib/carepal/display-name";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const DEFAULT_WHEN_NO_DB = {
  supabase: false as const,
  profile: {
    user_key: "",
    user_role: "family" as const,
    display_name: "訪客",
    family_notes: "（尚未連線：請在伺服器 .env 設定 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY）",
    mood_note: "—",
    inferred_profile: "",
    preferences: "",
    traits: "",
    visit_context: "",
    staff_interaction_satisfaction: "",
    memory_lines: [] as { content: string }[],
    updated_at: null as string | null,
  },
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userKey = searchParams.get("userKey");
  if (!isValidUserKey(userKey)) {
    return NextResponse.json(
      { error: "需要有效的 userKey 查詢參數（8–128 字元英數、底線、連字）" },
      { status: 400 }
    );
  }
  const userRole = parseUserRole(searchParams.get("userRole"));

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      ...DEFAULT_WHEN_NO_DB,
      profile: { ...DEFAULT_WHEN_NO_DB.profile, user_key: userKey, user_role: userRole },
    });
  }

  try {
    await getOrCreateProfile(supabase, userKey, userRole);
    const row = await fetchProfileRow(supabase, userKey, userRole);
    const memory_lines = await fetchMemoryLines(
      supabase,
      userKey,
      userRole,
      30
    );
    return NextResponse.json({
      supabase: true as const,
      profile: {
        user_key: userKey,
        user_role: userRole,
        display_name: row?.display_name ?? "訪客",
        family_notes: row?.family_notes ?? "",
        mood_note: row?.mood_note ?? "",
        inferred_profile: row?.inferred_profile ?? "",
        preferences: row?.preferences ?? "",
        traits: row?.traits ?? "",
        visit_context: row?.visit_context ?? "",
        staff_interaction_satisfaction:
          row?.staff_interaction_satisfaction ?? "",
        memory_lines,
        updated_at: row?.updated_at ?? null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[carepal/profile GET]", msg);
    const needsMigration = /user_role|42703|column|schema|does not exist/i.test(
      msg
    );
    const syncWarning = needsMigration
      ? "雲端資料表需更新：請在 Supabase SQL Editor 依序執行 001～004 之 migrations（完成後重新整理本頁）。在修正前可正常使用「儲存於本裝置」。"
      : "目前無法讀取雲端畫像。請檢查 .env 的 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY、網路，或改使用本裝置儲存。";
    return NextResponse.json({
      supabase: false,
      profile: {
        user_key: userKey,
        user_role: userRole,
        display_name: "訪客",
        family_notes: "",
        mood_note: "",
        inferred_profile: "",
        preferences: "",
        traits: "",
        visit_context: "",
        staff_interaction_satisfaction: "",
        memory_lines: [] as { content: string }[],
        updated_at: null,
      },
      syncWarning,
    });
  }
}

type PatchBody = {
  userKey?: string;
  userRole?: string;
  display_name?: string;
  family_notes?: string;
  mood_note?: string;
  inferred_profile?: string;
  preferences?: string;
  traits?: string;
  visit_context?: string;
  staff_interaction_satisfaction?: string;
};

export async function PATCH(request: Request) {
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isValidUserKey(body.userKey)) {
    return NextResponse.json({ error: "需要有效的 userKey" }, { status: 400 });
  }
  const userRole = parseUserRole(body.userRole);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "未設定 Supabase 環境變數" },
      { status: 503 }
    );
  }

  const patch: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.display_name === "string")
    patch.display_name = sanitizeDisplayName(body.display_name);
  if (typeof body.family_notes === "string")
    patch.family_notes = body.family_notes.slice(0, 2000);
  if (typeof body.mood_note === "string")
    patch.mood_note = body.mood_note.slice(0, 2000);
  if (typeof body.inferred_profile === "string")
    patch.inferred_profile = body.inferred_profile.slice(0, 3000);
  if (typeof body.preferences === "string")
    patch.preferences = body.preferences.slice(0, 2000);
  if (typeof body.traits === "string")
    patch.traits = body.traits.slice(0, 2000);
  if (typeof body.visit_context === "string")
    patch.visit_context = body.visit_context.slice(0, 2000);
  if (typeof body.staff_interaction_satisfaction === "string")
    patch.staff_interaction_satisfaction =
      body.staff_interaction_satisfaction.slice(0, 2000);

  try {
    await getOrCreateProfile(supabase, body.userKey!, userRole);
    const { error } = await supabase
      .from("carepal_profiles")
      .update(patch)
      .eq("user_key", body.userKey!)
      .eq("user_role", userRole);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "更新失敗";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
