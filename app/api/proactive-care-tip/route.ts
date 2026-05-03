import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { pickProactiveCareTipForVariety } from "@/lib/carepal/proactive-care-tips";
import { isUserRole, type UserRole } from "@/lib/carepal/user-role";

/**
 * GET /api/proactive-care-tip?role=family|patient&nonce=optional
 * 自「照顧者小錦囊」百題題庫依 nonce 穩定抽一則正文（不含開場聊天包裝）。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const r = searchParams.get("role") as UserRole | null;
  if (!r || !isUserRole(r) || (r !== "family" && r !== "patient")) {
    return NextResponse.json(
      { error: "需要 role=family 或 role=patient" },
      { status: 400 }
    );
  }
  const nonce =
    searchParams.get("nonce")?.trim().slice(0, 128) || randomUUID();
  try {
    const tip = pickProactiveCareTipForVariety(r, nonce).trim();
    if (!tip) {
      return NextResponse.json({ tip: null as string | null, source: null });
    }
    return NextResponse.json({
      tip,
      source: "照顧者小錦囊",
    });
  } catch (e) {
    console.error("[carepal] proactive-care-tip", e);
    return NextResponse.json({ tip: null as string | null, source: null });
  }
}
