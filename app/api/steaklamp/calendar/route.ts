import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayJstDateKey() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}


function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function minCap(seat: any) {
  return Number(seat.min_persons ?? seat.capacity_min ?? 1);
}

function maxCap(seat: any) {
  return Number(seat.max_persons ?? seat.capacity_max ?? 99);
}

function isPhysicalTableSeat(name: string) {
  return /^T\d+-\d+$/.test(name);
}

function isCounterSeat(name: string) {
  return /^C\d+$/.test(name);
}

function isCounterGroupSeat(name: string) {
  return /^C-\d+/.test(name);
}

function buildReservableTimes(dateKey: string) {
  const times: string[] = [];

  for (let h = 18; h <= 20; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 20 && m > 0) continue;
      times.push(`${dateKey}T${pad2(h)}:${pad2(m)}:00+09:00`);
    }
  }

  return times;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month");
    const persons = Number(url.searchParams.get("persons") ?? 2);
    const duration = Number(url.searchParams.get("duration") ?? 120);
    const counterOk = url.searchParams.get("counterOk") === "1";

    if (!month) {
      return json({ ok: false, error: "month_required" }, 400);
    }

    const [year, monthNum] = month.split("-").map(Number);
    if (!year || !monthNum) {
      return json({ ok: false, error: "invalid_month" }, 400);
    }

    const monthStart = new Date(year, monthNum - 1, 1);
    const monthEnd = new Date(year, monthNum, 0);

const todayKey = todayJstDateKey();


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

    const { data: businessHours, error: businessHoursError } = await supabaseAdmin
      .from("business_hours")
      .select("*")
      .eq("store_id", store.id);

    if (businessHoursError) {
      return json(
        {
          ok: false,
          error: "business_hours_load_failed",
          detail: businessHoursError.message,
        },
        500
      );
    }

    const { data: specialClosures } = await supabaseAdmin
      .from("special_closures")
      .select("*")
      .eq("store_id", store.id);

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

    const from = `${formatDateKey(monthStart)}T00:00:00+09:00`;
    const to = `${formatDateKey(monthEnd)}T23:59:59+09:00`;

    const { data: reservations, error: reservationsError } = await supabaseAdmin
      .from("reservations")
      .select("*")
      .eq("store_id", store.id)
      .gte("start_at", from)
      .lte("start_at", to);

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

    const hoursByWeekday = new Map(
      (businessHours ?? []).map((h: any) => [Number(h.weekday), h])
    );

    const closedDates = new Set(
      (specialClosures ?? [])
        .map((c: any) => c.closed_on ?? c.date ?? c.target_date)
        .filter(Boolean)
    );

    const allSeats = (seats ?? []).filter(
      (s: any) => s.is_active !== false && s.is_reservable !== false
    );

    const members = (seatMembers ?? []) as Array<{
      group_seat_id: string;
      member_seat_id: string;
    }>;

    const days: Record<
      string,
      {
        status: "available" | "few" | "full" | "closed";
        count: number;
        isClosed: boolean;
      }
    > = {};

    for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
      const dateKey = formatDateKey(d);
      const weekday = d.getDay();
      const bh = hoursByWeekday.get(weekday);

if (dateKey < todayKey) {
  days[dateKey] = {
    status: "closed",
    count: 0,
    isClosed: true,
  };
  continue;
}


      const isClosed = Boolean(bh?.is_closed) || closedDates.has(dateKey);

      if (isClosed) {
        days[dateKey] = {
          status: "closed",
          count: 0,
          isClosed: true,
        };
        continue;
      }

      const reservationCount = (reservations ?? []).filter((r: any) => {
        if (!r.start_at) return false;
        if (["cancelled", "finished", "no_show"].includes(String(r.status))) {
          return false;
        }

        const rDate = formatDateKey(new Date(r.start_at));
        return rDate === dateKey;
      }).length;

      const reservableTimes = buildReservableTimes(dateKey);

      let availableSlotCount = 0;

      for (const startRaw of reservableTimes) {
        const startAt = new Date(startRaw);
        const endAt = addMinutes(startAt, duration);

        const conflictSeatIds = new Set<string>();

        for (const r of reservations ?? []) {
          if (!r.seat_id || !r.start_at) continue;
          if (["cancelled", "finished", "no_show"].includes(String(r.status))) {
            continue;
          }

          const rStart = new Date(r.start_at);
          const rEnd = addMinutes(rStart, Number(r.duration_minutes ?? 120));

          if (overlaps(startAt, endAt, rStart, rEnd)) {
            conflictSeatIds.add(String(r.seat_id));
          }
        }

        const hasAvailableSeat = allSeats.some((seat: any) => {
          const seatName = String(seat.name ?? "");

          if (isPhysicalTableSeat(seatName)) return false;

          if (!counterOk && isCounterSeat(seatName)) return false;

          if (persons <= 1 && isCounterGroupSeat(seatName)) return false;

          if (persons < minCap(seat) || persons > maxCap(seat)) return false;

          if (conflictSeatIds.has(String(seat.id))) return false;

          const memberIds = members
            .filter((m) => String(m.group_seat_id) === String(seat.id))
            .map((m) => String(m.member_seat_id));

          for (const memberId of memberIds) {
            if (conflictSeatIds.has(memberId)) return false;
          }

          return true;
        });

        if (hasAvailableSeat) availableSlotCount++;
      }

      let status: "available" | "few" | "full" = "full";

      if (availableSlotCount >= 5) {
        status = "available";
      } else if (availableSlotCount >= 1) {
        status = "few";
      } else {
        status = "full";
      }

      days[dateKey] = {
        status,
        count: reservationCount,
        isClosed: false,
      };
    }

    return json({
      ok: true,
      month,
      persons,
      duration,
      counterOk,
      days,
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
