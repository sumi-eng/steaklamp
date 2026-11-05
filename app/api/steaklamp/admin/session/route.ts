import { NextResponse } from "next/server";
import { getAdminAuthMode, getAdminStatus } from "@/steaklamp/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 管理画面が、ログインの有効性を確認するためのAPI（認証の判定結果を返すだけ。個人情報は返さない）
export async function GET() {
  const status = await getAdminStatus();
  return NextResponse.json(
    {
      ok: true,
      signedIn: status.signedIn,
      isAdmin: status.isAdmin,
      enforce: getAdminAuthMode() === "enforce",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
