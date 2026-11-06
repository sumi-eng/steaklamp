import { NextResponse } from "next/server";
import { requireAdmin } from "@/steaklamp/lib/adminAuth";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { effectiveSeatIds } from "@/steaklamp/lib/inbound/seat-allocation";
import { loadSeatLinks } from "@/steaklamp/lib/reservationSeats";

export const runtime = "nodejs";

const STORE_CODE = "steaklamp";

export async function GET() {
  const denied = await requireAdmin("reservations/history");
  if (denied) return denied;

  try {
    // 店舗取得
    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id")
      .eq("code", STORE_CODE)
      .single();

    if (storeError || !store) {
      return NextResponse.json(
        { ok: false, error: "store_not_found" },
        { status: 500 }
      );
    }

    // 予約取得（新着順）
    const { data: reservations, error: resError } = await supabaseAdmin
      .from("reservations")
      .select(`
        id,
        seat_id,
        name,
        phone,
        email,
        persons,
        start_at,
        duration_minutes,
        status,
        notes,
        source,
        course_name_snapshot,
        course_price_snapshot,
        created_at
      `)
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (resError) {
      return NextResponse.json(
        { ok: false, error: resError.message },
        { status: 500 }
      );
    }

    // 席取得
    const { data: seats } = await supabaseAdmin
      .from("seats")
      .select("id, name");

    const seatMap = new Map(
      (seats ?? []).map((s) => [s.id, s.name])
    );

    // 整形
    // 自由連結した予約は「T1-1・T1-2・C3」のように連結した席名を並べる
    const seatLinks = await loadSeatLinks((reservations ?? []).map((r) => r.id));
    const items = (reservations ?? []).map((r) => {
      const linked = effectiveSeatIds(r, seatLinks);
      return {
        ...r,
        seat_name:
          linked.length > 1
            ? linked.map((sid) => seatMap.get(sid) ?? sid).join("・")
            : seatMap.get(r.seat_id) ?? r.seat_id,
      };
    });

    return NextResponse.json({ ok: true, items });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
