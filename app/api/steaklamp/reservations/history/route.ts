import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

const STORE_CODE = "steaklamp";

export async function GET() {
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
    const items = (reservations ?? []).map((r) => ({
      ...r,
      seat_name: seatMap.get(r.seat_id) ?? r.seat_id,
    }));

    return NextResponse.json({ ok: true, items });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
