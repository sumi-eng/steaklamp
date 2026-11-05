import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { dateLabel, isChristmasDate } from "@/steaklamp/lib/christmas";
import {
  getSteaklampStoreId,
  loadDaySummaries,
} from "@/steaklamp/lib/christmas-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 予約台帳用：12/24・25の残り組数・名数と、手動締切の状態
export async function GET() {
  try {
    const storeId = await getSteaklampStoreId();
    const { summaries } = await loadDaySummaries(storeId);
    return NextResponse.json(
      {
        ok: true,
        days: summaries.map((s) => ({ ...s, label: dateLabel(s.date) })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown_error" },
      { status: 500 }
    );
  }
}

// 日ごとの受付の手動締切・再開
export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const date = String(body.date ?? "");
    const isClosed = body.is_closed === true;

    if (!isChristmasDate(date)) {
      return NextResponse.json({ ok: false, error: "invalid_date" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("christmas_day_settings")
      .upsert(
        { event_date: date, is_closed: isClosed, updated_at: new Date().toISOString() },
        { onConflict: "event_date" }
      );
    if (error) throw error;

    return NextResponse.json({ ok: true, date, is_closed: isClosed });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown_error" },
      { status: 500 }
    );
  }
}
