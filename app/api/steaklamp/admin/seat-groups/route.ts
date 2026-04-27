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

  const { data: seats, error: seatsError } = await supabaseAdmin
    .from("seats")
    .select("id, name, seat_type, capacity_min, capacity_max, sort_order")
    .eq("store_id", store.id)
    .order("sort_order", { ascending: true });

  if (seatsError) {
    return json({ ok: false, error: "load_seats_failed", detail: seatsError.message }, 500);
  }

  const { data: members, error: membersError } = await supabaseAdmin
    .from("seat_members")
    .select("id, group_seat_id, member_seat_id");

  if (membersError) {
    return json({ ok: false, error: "load_members_failed", detail: membersError.message }, 500);
  }

  return json({
    ok: true,
    seats: seats ?? [],
    members: members ?? [],
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const groupSeatId = String(body?.groupSeatId ?? "");
    const memberSeatIds = Array.isArray(body?.memberSeatIds) ? body.memberSeatIds : null;

    if (!groupSeatId) {
      return json({ ok: false, error: "groupSeatId_required" }, 400);
    }

    if (!memberSeatIds) {
      return json({ ok: false, error: "memberSeatIds_required" }, 400);
    }

    const { error: deleteError } = await supabaseAdmin
      .from("seat_members")
      .delete()
      .eq("group_seat_id", groupSeatId);

    if (deleteError) {
      return json({ ok: false, error: "delete_failed", detail: deleteError.message }, 500);
    }

    if (memberSeatIds.length > 0) {
      const payload = memberSeatIds.map((memberSeatId: string) => ({
        group_seat_id: groupSeatId,
        member_seat_id: memberSeatId,
      }));

      const { error: insertError } = await supabaseAdmin
        .from("seat_members")
        .insert(payload);

      if (insertError) {
        return json({ ok: false, error: "insert_failed", detail: insertError.message }, 500);
      }
    }

    const { data: members, error: reloadError } = await supabaseAdmin
      .from("seat_members")
      .select("id, group_seat_id, member_seat_id");

    if (reloadError) {
      return json({ ok: false, error: "reload_failed", detail: reloadError.message }, 500);
    }

    return json({ ok: true, members: members ?? [] });
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
