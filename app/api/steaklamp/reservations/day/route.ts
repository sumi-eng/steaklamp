import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toTime(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function maxCap(seat: any) {
  return Number(seat.max_persons ?? seat.capacity_max ?? 1);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");

    if (!date) {
      return json({ ok: false, error: "date_required" }, 400);
    }

    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);

    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id, code")
      .eq("code", "steaklamp")
      .single();

    if (storeError || !store) {
      return json(
        { ok: false, error: "store_not_found", detail: storeError?.message },
        404
      );
    }

    const { data: seats, error: seatsError } = await supabaseAdmin
      .from("seats")
      .select("*")
      .eq("store_id", store.id);

    if (seatsError) {
      return json(
        { ok: false, error: "seats_load_failed", detail: seatsError.message },
        500
      );
    }

    const { data: seatMembers, error: seatMembersError } = await supabaseAdmin
      .from("seat_members")
      .select("group_seat_id, member_seat_id");

    if (seatMembersError) {
      return json(
        {
          ok: false,
          error: "seat_members_load_failed",
          detail: seatMembersError.message,
        },
        500
      );
    }

    const allSeats = (seats ?? []) as any[];
    const members = (seatMembers ?? []) as Array<{
      group_seat_id: string;
      member_seat_id: string;
    }>;

    const seatById = new Map(allSeats.map((s) => [String(s.id), s]));

    const groupParentSeatIds = new Set(
      members.map((m) => String(m.group_seat_id))
    );

    const physicalSeats = allSeats
      .filter((s) => {
        const name = String(s.name ?? "");
        return /^C\d+$/.test(name) || /^T\d+-\d+$/.test(name);
      })
      .filter((s) => s.is_active !== false)
      .sort((a, b) => {
        const ao = Number(a.sort_order ?? 9999);
        const bo = Number(b.sort_order ?? 9999);
        if (ao !== bo) return ao - bo;
        return String(a.name).localeCompare(String(b.name), "ja");
      });

    const physicalSeatIds = new Set(physicalSeats.map((s) => String(s.id)));

    const { data: reservations, error: reservationsError } = await supabaseAdmin
      .from("reservations")
      .select("*")
      .eq("store_id", store.id)
      .gte("start_at", dayStart.toISOString())
      .lte("start_at", dayEnd.toISOString());

    if (reservationsError) {
      return json(
        {
          ok: false,
          error: "reservations_load_failed",
          detail: reservationsError.message,
        },
        500
      );
    }

    const rows = physicalSeats.map((seat) => ({
      id: String(seat.id),
      label: String(seat.name),
      capacityLabel: `${maxCap(seat)}名`,
    }));

    const items = (reservations ?? [])
      .filter((r) => {
        const status = String(r.status ?? "booked");
        return !["cancelled", "finished", "no_show"].includes(status);
      })
      .map((r) => {
        const seat = seatById.get(String(r.seat_id));
        const start = new Date(r.start_at);
        const duration = Number(r.duration_minutes ?? 120);
        const slots = Math.max(1, Math.ceil(duration / 15));

        let rowIds: string[] = [];

        if (seat && groupParentSeatIds.has(String(seat.id))) {
          rowIds = members
            .filter((m) => String(m.group_seat_id) === String(seat.id))
            .map((m) => String(m.member_seat_id))
            .filter((id) => physicalSeatIds.has(id));
        } else if (r.seat_id) {
          rowIds = [String(r.seat_id)].filter((id) =>
            physicalSeatIds.has(id)
          );
        }

       return {
  id: String(r.id),
seatId: String(r.seat_id ?? ""),

  dateKey: toDateKey(start),
  title: String(r.name ?? "予約"),
  name: String(r.name ?? "予約"),
  phone: r.phone ?? null,
  email: r.email ?? null,
  persons: Number(r.persons ?? 0),
  start: toTime(start),
  startAt: r.start_at,
  durationMinutes: duration,
  slots,
  seatName: seat?.name ?? "",
  status: String(r.status ?? "booked"),
  notes: r.notes ?? null,
  rowIds,
};

      })
      .filter((r) => r.rowIds.length > 0);

    return json({
      ok: true,
      date,
      rows,
      items,
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "unexpected_error",
        detail: e instanceof Error ? e.message : "unknown_error",
      },
      500
    );
  }
}
