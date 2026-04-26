import { NextResponse } from "next/server";
import { isValidUserKey } from "@/lib/carepal/user-key";
import { parseUserRole } from "@/lib/carepal/user-role";
import { getOrCreateProfile } from "@/lib/carepal/memory-store";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const MAX_LEN = 2000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userKey = searchParams.get("userKey");
  if (!isValidUserKey(userKey)) {
    return NextResponse.json(
      { error: "需要有效的 userKey" },
      { status: 400 }
    );
  }
  const userRole = parseUserRole(searchParams.get("userRole"));
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      supabase: false,
      entries: [] as {
        id: string;
        content: string;
        kind: string;
        created_at: string;
      }[],
    });
  }
  try {
    await getOrCreateProfile(supabase, userKey, userRole);
    const { data, error } = await supabase
      .from("carepal_memory_entries")
      .select("id, content, kind, created_at")
      .eq("user_key", userKey)
      .eq("user_role", userRole)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json({ supabase: true, entries: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[carepal/memory GET]", msg);
    return NextResponse.json({
      supabase: false,
      entries: [] as {
        id: string;
        content: string;
        kind: string;
        created_at: string;
      }[],
    });
  }
}

type PostBody = {
  userKey?: string;
  userRole?: string;
  content?: string;
  kind?: string;
};

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isValidUserKey(body.userKey)) {
    return NextResponse.json({ error: "需要有效的 userKey" }, { status: 400 });
  }
  const userRole = parseUserRole(body.userRole);
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content 不可為空" }, { status: 400 });
  }
  if (content.length > MAX_LEN) {
    return NextResponse.json(
      { error: `內容過長（上限 ${MAX_LEN} 字）` },
      { status: 400 }
    );
  }
  const kind =
    typeof body.kind === "string" && body.kind.length <= 32
      ? body.kind
      : "note";

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "未設定 Supabase" },
      { status: 503 }
    );
  }
  try {
    await getOrCreateProfile(supabase, body.userKey!, userRole);
    const { data, error } = await supabase
      .from("carepal_memory_entries")
      .insert({
        user_key: body.userKey!,
        user_role: userRole,
        content,
        kind,
      })
      .select("id, content, kind, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, entry: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "寫入失敗";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
