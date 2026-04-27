import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET() {
  const { data: store, error: storeError } = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("code", "steaklamp")
    .single();

  if (storeError || !store) {
    return json({ ok: false, error: "store_not_found" }, 404);
  }

  const { data, error } = await supabaseAdmin
    .from("seats")
    .select("*")
    .eq("store_id", store.id)
    .order("sort_order", { ascending: true });

  if (error) {
    return json({ ok: false, error: "load_failed", detail: error.message }, 500);
  }

  return json({ ok: true, rows: data ?? [] });
}

export async function POST(req: Request) {
  try {
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

    const normalized = rows.map((row: any) => {
      const name = String(row.name ?? "").trim();
      if (!name) {
        throw new Error("席名が未入力です。");
      }

      const capacityMin = Number(row.capacity_min ?? 1);
      const capacityMax = Number(row.capacity_max ?? 1);

      if (!Number.isFinite(capacityMin) || !Number.isFinite(capacityMax)) {
        throw new Error(`人数設定が不正です: ${name}`);
      }

      if (capacityMin < 1 || capacityMax < 1 || capacityMin > capacityMax) {
        throw new Error(`人数設定が不正です: ${name}`);
      }

      return {
        id: row.id ?? null,
        store_id: store.id,
        name,
        zone: String(row.zone ?? "hall").trim(),
        seat_type: row.seat_type === "group" ? "group" : "table",
        capacity_min: capacityMin,
        capacity_max: capacityMax,
        is_active: Boolean(row.is_active),
        is_reservable: Boolean(row.is_reservable),
        sort_order: Number(row.sort_order ?? 0),
      };
    });

    const existingRows = normalized.filter((row: any) => row.id);

const newRows = normalized
  .filter((row: any) => !row.id)
  .map(({ id, ...rest }: any) => rest);


    if (existingRows.length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("seats")
        .upsert(existingRows, {
          onConflict: "id",
        });

      if (updateError) {
        return json(
          { ok: false, error: "update_failed", detail: updateError.message },
          500
        );
      }
    }

    if (newRows.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("seats")
        .insert(newRows);

      if (insertError) {
        return json(
          { ok: false, error: "insert_failed", detail: insertError.message },
          500
        );
      }
    }

    const { data: savedRows, error: reloadError } = await supabaseAdmin
      .from("seats")
      .select("*")
      .eq("store_id", store.id)
      .order("sort_order", { ascending: true });

    if (reloadError) {
      return json(
        { ok: false, error: "reload_failed", detail: reloadError.message },
        500
      );
    }

    return json({ ok: true, rows: savedRows ?? [] });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "save_failed",
        detail: e instanceof Error ? e.message : "unknown_error",
      },
      500
    );
  }
}
