import { NextResponse } from "next/server";
import { buildProactiveTipFromRag } from "@/lib/carepal/proactive-rag-tip";
import { isUserRole, type UserRole } from "@/lib/carepal/user-role";

/**
 * GET /api/proactive-care-tip?role=family|patient
 * 以 RAG 取一段衛教摘錄，供開場「小錦囊」；失敗時前端可退回靜態題庫。
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
  try {
    const built = await buildProactiveTipFromRag(r);
    if (!built) {
      return NextResponse.json({ tip: null as string | null, source: null });
    }
    return NextResponse.json({
      tip: built.excerpt,
      source: built.source,
    });
  } catch (e) {
    console.error("[carepal] proactive-care-tip", e);
    return NextResponse.json({ tip: null as string | null, source: null });
  }
}
