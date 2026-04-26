import { NextResponse } from "next/server";
import { isValidUserKey } from "@/lib/carepal/user-key";
import { parseUserRole } from "@/lib/carepal/user-role";
import { getOrCreateProfile } from "@/lib/carepal/memory-store";
import { todayDateTaipei } from "@/lib/carepal/staff-feed";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/carepal/user-role";

type Scope =
  | "inferred_trio"
  | "chat_turns"
  | "inferred_trio_and_chat_turns";

const SCOPES = new Set<string>([
  "inferred_trio",
  "chat_turns",
  "inferred_trio_and_chat_turns",
]);

type Body = { userKey?: string; userRole?: string; scope?: string };

/**
 * 一鍵清空：歸納三欄、或刪除 kind=chat_turn 的稽核筆、或兩者。
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isValidUserKey(body.userKey)) {
    return NextResponse.json({ error: "需要有效的 userKey" }, { status: 400 });
  }
  const userRole = parseUserRole(body.userRole);
  if (!body.scope || !SCOPES.has(body.scope)) {
    return NextResponse.json(
      {
        error:
          "需要 scope: inferred_trio | chat_turns | inferred_trio_and_chat_turns",
      },
      { status: 400 }
    );
  }
  const scope = body.scope as Scope;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "未設定 Supabase 環境變數" },
      { status: 503 }
    );
  }

  const userKey = body.userKey!;

  try {
    await getOrCreateProfile(supabase, userKey, userRole);

    if (scope === "inferred_trio" || scope === "inferred_trio_and_chat_turns") {
      const { error } = await supabase
        .from("carepal_profiles")
        .update({
          inferred_profile: "",
          preferences: "",
          traits: "",
          visit_context: "",
          staff_interaction_satisfaction: "",
          updated_at: new Date().toISOString(),
        })
        .eq("user_key", userKey)
        .eq("user_role", userRole);
      if (error) throw error;
      const ur = userRole as UserRole;
      if (ur === "family" || ur === "patient") {
        const d = todayDateTaipei();
        const { error: fErr } = await supabase
          .from("carepal_staff_feed")
          .delete()
          .eq("contributor_key", userKey)
          .eq("contributor_role", ur)
          .eq("signal_date", d);
        if (fErr) throw fErr;
      }
    }

    if (scope === "chat_turns" || scope === "inferred_trio_and_chat_turns") {
      const { error } = await supabase
        .from("carepal_memory_entries")
        .delete()
        .eq("user_key", userKey)
        .eq("user_role", userRole)
        .eq("kind", "chat_turn");
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "清除失敗";
    console.error("[carepal/profile/reset]", e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
