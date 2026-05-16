import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function toJstDate(raw: string) {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) {
    return new Date(value);
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value}:00+09:00`);
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value}+09:00`);
  }

  return new Date(value);
}


function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

type SeatRow = {
  id: string;
  name: string;
  type?: string | null;
  min_persons?: number | null;
  max_persons?: number | null;
  capacity_min?: number | null;
  capacity_max?: number | null;
  is_active?: boolean | null;
  is_reservable?: boolean | null;
  sort_order?: number | null;
};

type SeatMemberRow = {
  group_seat_id: string;
  member_seat_id: string;
};

function minCap(seat: SeatRow) {
  return Number(seat.min_persons ?? seat.capacity_min ?? 1);
}

function maxCap(seat: SeatRow) {
  return Number(seat.max_persons ?? seat.capacity_max ?? 99);
}

// 親席IDではなく、実際に使う物理席IDだけに展開する
function expandPhysicalSeatIds(
  seatId: string,
  members: SeatMemberRow[],
  seats: SeatRow[]
) {
  const id = String(seatId);

  const childIds = members
    .filter((m) => String(m.group_seat_id) === id)
    .map((m) => String(m.member_seat_id));

  if (childIds.length > 0) {
    return new Set(childIds);
  }

  const seat = seats.find((s) => String(s.id) === id);
  const seatName = String(seat?.name ?? "");

  const idsByName = new Map(seats.map((s) => [String(s.name), String(s.id)]));

  function ids(names: string[]) {
    return new Set(
      names
        .map((name) => idsByName.get(name))
        .filter(Boolean) as string[]
    );
  }

  if (seatName === "右テーブル") return ids(["T1-1", "T1-2"]);
  if (seatName === "中テーブル") return ids(["T2-1", "T2-2"]);
  if (seatName === "左テーブル") return ids(["T3-1", "T3-2"]);

  if (seatName === "右6名席") return ids(["T1-1", "T1-2"]);
  if (seatName === "中6名席") return ids(["T2-1", "T2-2"]);
  if (seatName === "左6名席") return ids(["T3-1", "T3-2"]);

  return new Set([id]);
}

function hasSeatConflict(a: Set<string>, b: Set<string>) {
  for (const id of a) {
    if (b.has(id)) return true;
  }
  return false;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const persons = Number(body.persons ?? 0);
    const startAtRaw = String(body.startAt ?? "");
    const duration = Number(body.duration ?? 120);
    const counterOk = Boolean(body.counterOk ?? false);

    if (!persons || !startAtRaw || !duration) {
      return json({ ok: false, error: "missing_params" }, 400);
    }

    const startAt = toJstDate(startAtRaw);

   if (!startAt || Number.isNaN(startAt.getTime())) {
  return json({ ok: false, error: "invalid_startAt", startAtRaw }, 400);
}


    const endAt = addMinutes(startAt, duration);

    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id, code")
      .eq("code", "steaklamp")
      .single();

    if (storeError || !store) {
      return json(
        {
          ok: false,
          error: "store_not_found",
          detail: storeError?.message,
        },
        500
      );
    }

const dateKey = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(startAt);

const { data: closure, error: closureError } = await supabaseAdmin
  .from("store_closures")
  .select("id, reason")
  .eq("store_id", store.id)
  .eq("closed_on", dateKey)
  .maybeSingle();

if (closureError) {
  return json(
    {
      ok: false,
      error: "closure_load_failed",
      detail: closureError.message,
    },
    500
  );
}

if (closure) {
  return json({
    ok: true,
    seats: [],
    closed: true,
    reason: closure.reason || "臨時休業日です",
  });
}


    const { data: seats, error: seatsError } = await supabaseAdmin
      .from("seats")
      .select("*")
      .eq("store_id", store.id);

    if (seatsError) {
      console.error("seatsError", seatsError);
      return json(
        {
          ok: false,
          error: "seats_load_failed",
          detail: seatsError.message,
          fullError: seatsError,
        },
        500
      );
    }

    const typedSeats = ((seats ?? []) as SeatRow[])
      .filter((s) => s.is_active !== false)
      .filter((s) => s.is_reservable !== false)
      .sort((a, b) => {
        const ao = Number(a.sort_order ?? 9999);
        const bo = Number(b.sort_order ?? 9999);
        if (ao !== bo) return ao - bo;
        return String(a.name).localeCompare(String(b.name), "ja");
      });

    const { data: seatMembers, error: seatMembersError } = await supabaseAdmin
      .from("seat_members")
      .select("group_seat_id, member_seat_id");

    if (seatMembersError) {
      console.error("seatMembersError", seatMembersError);
      return json(
        {
          ok: false,
          error: "seat_members_load_failed",
          detail: seatMembersError.message,
        },
        500
      );
    }

    const members = (seatMembers ?? []) as SeatMemberRow[];

    const { data: reservations, error: reservationsError } = await supabaseAdmin
      .from("reservations")
      .select("*")
      .eq("store_id", store.id)
      .gte("start_at", addMinutes(startAt, -240).toISOString())
      .lte("start_at", addMinutes(endAt, 240).toISOString());

    if (reservationsError) {
      console.error("reservationsError", reservationsError);
      return json(
        {
          ok: false,
          error: "reservations_load_failed",
          detail: reservationsError.message,
        },
        500
      );
    }

    // 予約済みの「実際に使っている物理席」だけを集める
    const occupiedPhysicalSeatIds = new Set<string>();

    for (const r of reservations ?? []) {
      if (!r.seat_id || !r.start_at) continue;
      if (["cancelled", "finished", "no_show"].includes(String(r.status))) {
        continue;
      }

      const rStart = new Date(r.start_at);
      const rEnd = addMinutes(rStart, Number(r.duration_minutes ?? 120));

      if (!overlaps(startAt, endAt, rStart, rEnd)) continue;

      const reservedPhysicalSeatIds = expandPhysicalSeatIds(String(r.seat_id), members, typedSeats)

      ;

      for (const id of reservedPhysicalSeatIds) {
        occupiedPhysicalSeatIds.add(id);
      }
    }

    const physicalNameById = new Map(
      typedSeats.map((s) => [String(s.id), String(s.name)])
    );

    const result = typedSeats
      .filter((seat) => {
        const seatName = String(seat.name ?? "");

        const isPhysicalTableSeat = /^T\d+-\d+$/.test(seatName);
        const isCounterSeat = /^C\d+$/.test(seatName);
        const isCounterGroupSeat = /^C-\d+/.test(seatName);

        // T1-1 / T1-2 などの物理テーブル席は予約候補に出さない
        // 予約は「右テーブル」「中テーブル」「左テーブル」「右8名席」などで取る
        if (isPhysicalTableSeat) return false;

        // カウンター席・カウンター連結席は「カウンター席でも可」のときだけ候補に出す
        if (!counterOk && (isCounterSeat || isCounterGroupSeat)) return false;

        // 1名予約では C-45 / C-78 / C-678 / C-3456 などのカウンター連結席は出さない
        if (persons <= 1 && isCounterGroupSeat) return false;

        if (persons < minCap(seat) || persons > maxCap(seat)) return false;

const isSixSeatGroup =
  seatName === "右6名席" ||
  seatName === "左6名席";

if (persons >= 6 && isSixSeatGroup) return false;


        const candidatePhysicalSeatIds = expandPhysicalSeatIds(String(seat.id), members, typedSeats)
;

        // 親席IDではなく、物理席同士で重複判定する
        if (hasSeatConflict(candidatePhysicalSeatIds, occupiedPhysicalSeatIds)) {
          return false;
        }

        return true;
      })
      .map((seat) => {
        let physicalSeats = String(seat.name);

        const memberNames = members
          .filter((m) => String(m.group_seat_id) === String(seat.id))
          .map((m) => physicalNameById.get(String(m.member_seat_id)))
          .filter(Boolean) as string[];

        if (memberNames.length > 0) {
          physicalSeats = memberNames.join(" / ");
        }

        return {
          id: seat.id,
          name: seat.name,
          capacityLabel: `${minCap(seat)}〜${maxCap(seat)}名`,
          physicalSeats,
        };
      });

    return json({ ok: true, seats: result });
  } catch (e) {
    console.error("unexpected seats/search error", e);
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
