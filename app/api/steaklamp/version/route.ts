import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 現在デプロイされているビルドの識別子。画面側が持つ識別子と比べて、新しいバージョンかどうかを判定する。
export async function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
