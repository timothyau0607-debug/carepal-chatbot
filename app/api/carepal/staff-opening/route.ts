import { NextResponse } from "next/server";
import { buildStaffOpeningBriefingForWelcome } from "@/lib/carepal/staff-opening-briefing";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * 醫護端開場用：今日家屬／病友打氣、按讚、留言與 staff_feed 摘段（無 DB 或未設定時為空）。
 */
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ briefing: "" as string });
  }
  try {
    const briefing = await buildStaffOpeningBriefingForWelcome(supabase);
    return NextResponse.json({ briefing });
  } catch (e) {
    console.error("[carepal/staff-opening GET]", e);
    return NextResponse.json({ briefing: "" as string });
  }
}
