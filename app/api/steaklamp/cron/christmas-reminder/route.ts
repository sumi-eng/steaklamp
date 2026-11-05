import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { sendChristmasReminderEmail } from "@/steaklamp/lib/christmas-mail";
import {
  countsTowardLimit,
  isChristmasDate,
  jstDateKey,
} from "@/steaklamp/lib/christmas";
import { getSteaklampStoreId } from "@/steaklamp/lib/christmas-server";
import type { ChristmasRow } from "@/steaklamp/lib/christmas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel Cron から毎日呼ばれる。翌日がクリスマス対象日なら、その予約にリマインドメールを送る。
// 認証: Authorization: Bearer ${CRON_SECRET}（Vercel Cron が自動で付ける）
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const tomorrow = jstDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
    if (!isChristmasDate(tomorrow)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "not_christmas_eve", tomorrow });
    }

    const storeId = await getSteaklampStoreId();
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select("id, name, email, phone, persons, start_at, notes, status, course_name_snapshot, reminder_sent_at")
      .eq("store_id", storeId)
      .gte("start_at", `${tomorrow}T00:00:00+09:00`)
      .lte("start_at", `${tomorrow}T23:59:59+09:00`);
    if (error) throw error;

    let sent = 0;
    let noEmail = 0;
    let failed = 0;

    for (const r of data ?? []) {
      if (!countsTowardLimit(r as unknown as ChristmasRow)) continue;
      if (r.reminder_sent_at) continue;
      if (!r.email) {
        noEmail += 1;
        continue;
      }
      try {
        const ok = await sendChristmasReminderEmail(r);
        if (ok) {
          await supabaseAdmin
            .from("reservations")
            .update({ reminder_sent_at: new Date().toISOString() })
            .eq("id", r.id);
          sent += 1;
        }
      } catch (e) {
        failed += 1;
        console.error("christmas reminder failed", r.id, e);
      }
    }

    return NextResponse.json({ ok: true, tomorrow, sent, noEmail, failed });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown_error" },
      { status: 500 }
    );
  }
}
