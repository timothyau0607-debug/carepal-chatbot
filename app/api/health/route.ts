import { NextResponse } from "next/server";

/** 健康檢查與 BFF 是否啟用；之後可加入資料庫、外部語音服務等狀態。 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: "carepal",
    at: new Date().toISOString(),
  });
}
