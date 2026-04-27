import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const DEFAULT_ROWS = [
  { weekday: 0, is_closed: false },
  { weekday: 1, is_closed: false },
  { weekday: 2, is_closed: false },
  { weekday: 3, is_closed: true },
  { weekday: 4, is_closed: false },
  { weekday: 5, is_closed: false },
  { weekday: 6, is_closed: false },
];

export async function GET() {
  const { data: store, error: storeError } = await supabaseAdmin
    .from("stores")
    .select("id, code, name, timezone, is_active")
    .eq("code", "steaklamp")
    .single();

  if (storeError || !store) {
    return json({ ok: false, error: "store_not_found" }, 404);
  }

  const { data: rows, error: rowsError } = await supabaseAdmin
    .from("business_hours")
    .select("*")
    .eq("store_id", store.id)
    .order("weekday", { ascending: true });

  if (rowsError) {
    return json({ ok: false, error: "load_failed", detail: rowsError.message }, 500);
  }

  if (!rows || rows.length === 0) {
    const seed = DEFAULT_ROWS.map((r) => ({
      store_id: store.id,
      weekday: r.weekday,
      is_closed: r.is_closed,
      open_on_day_before_holiday: false,
      open_time: r.is_closed ? null : "18:00",
      close_time: r.is_closed ? null : "22:00",
      reservation_start_time: r.is_closed ? null : "18:00",
      reservation_end_time: r.is_closed ? null : "20:00",
      reservation_interval_minutes: 15,
      default_stay_minutes: 120,
    }));

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("business_hours")
      .insert(seed)
      .select("*")
      .order("weekday", { ascending: true });

    if (insertError) {
      return json({ ok: false, error: "seed_failed", detail: insertError.message }, 500);
    }

    return json({ ok: true, store, rows: inserted });
  }

  return json({ ok: true, store, rows });
}

export async function POST(req: Request) {
  const body = await req.json();

  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows) {
    return json({ ok: false, error: "rows_required" }, 400);
  }

  const { data: store, error: storeError } = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("code", "steaklamp")
    .single();

  if (storeError || !store) {
    return json({ ok: false, error: "store_not_found" }, 404);
  }

  for (const row of rows) {
    const payload = {
      store_id: store.id,
      weekday: Number(row.weekday),
      is_closed: Boolean(row.is_closed),
      open_on_day_before_holiday: Boolean(row.open_on_day_before_holiday),
      open_time: row.is_closed ? null : row.open_time || null,
      close_time: row.is_closed ? null : row.close_time || null,
      reservation_start_time: row.is_closed ? null : row.reservation_start_time || null,
      reservation_end_time: row.is_closed ? null : row.reservation_end_time || null,
      reservation_interval_minutes: Number(row.reservation_interval_minutes || 15),
      default_stay_minutes: Number(row.default_stay_minutes || 120),
    };

    const { error } = await supabaseAdmin
      .from("business_hours")
      .upsert(payload, {
        onConflict: "store_id,weekday",
      });

    if (error) {
      return json({ ok: false, error: "save_failed", detail: error.message }, 500);
    }
  }

  return json({ ok: true });
}
