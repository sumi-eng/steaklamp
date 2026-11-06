import { NextResponse } from "next/server";
import { requireAdmin } from "@/steaklamp/lib/adminAuth";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET() {
  const denied = await requireAdmin("admin/seats GET");
  if (denied) return denied;

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

// 席の削除。予約の連結（reservation_seats）や予約・グループ席に使われている席は削除できない。
// DB側も reservation_seats.seat_id の外部キー（on delete restrict）で同じ席の削除を止める。
export async function DELETE(req: Request) {
  const denied = await requireAdmin("admin/seats DELETE");
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const seatId = String(body?.id ?? "").trim();
    if (!seatId) return json({ ok: false, error: "id_required" }, 400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seatId)) {
      return json({ ok: false, error: "invalid_id" }, 400);
    }

    const [links, reservations, groups] = await Promise.all([
      supabaseAdmin.from("reservation_seats").select("reservation_id", { count: "exact", head: true }).eq("seat_id", seatId),
      supabaseAdmin.from("reservations").select("id", { count: "exact", head: true }).eq("seat_id", seatId),
      supabaseAdmin
        .from("seat_members")
        .select("id", { count: "exact", head: true })
        .or(`group_seat_id.eq.${seatId},member_seat_id.eq.${seatId}`),
    ]);

    if (links.error || reservations.error || groups.error) {
      return json({ ok: false, error: "usage_check_failed" }, 500);
    }

    if ((links.count ?? 0) > 0) {
      return json(
        {
          ok: false,
          error: "seat_in_use_by_linked_reservations",
          detail: `この席は ${links.count} 件の予約の席の連結に使われているため、削除できません。先にそれらの予約の席を変更してください。`,
        },
        409
      );
    }

    if ((reservations.count ?? 0) > 0) {
      return json(
        {
          ok: false,
          error: "seat_in_use_by_reservations",
          detail: `この席は ${reservations.count} 件の予約に使われているため、削除できません。削除せず、無効にしてください。`,
        },
        409
      );
    }

    if ((groups.count ?? 0) > 0) {
      return json(
        {
          ok: false,
          error: "seat_in_use_by_groups",
          detail: "この席はグループ席の構成に使われているため、削除できません。先にグループ席の構成から外してください。",
        },
        409
      );
    }

    const { error } = await supabaseAdmin.from("seats").delete().eq("id", seatId);
    if (error) {
      // 外部キー違反（23503）は、確認後に新しく使われた場合など
      if (error.code === "23503") {
        return json(
          { ok: false, error: "seat_in_use", detail: "この席は予約などで使われているため、削除できません。" },
          409
        );
      }
      return json({ ok: false, error: "delete_failed", detail: error.message }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    return json(
      { ok: false, error: "delete_failed", detail: e instanceof Error ? e.message : "unknown_error" },
      500
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin("admin/seats POST");
  if (denied) return denied;

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
