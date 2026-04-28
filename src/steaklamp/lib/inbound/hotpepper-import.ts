import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { parseHotpepperReservationMail } from "./hotpepper-parser";

type SeatRow = {
  id: string;
  name: string;
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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function minCap(seat: SeatRow) {
  return Number(seat.min_persons ?? seat.capacity_min ?? 1);
}

function maxCap(seat: SeatRow) {
  return Number(seat.max_persons ?? seat.capacity_max ?? 99);
}

function buildStartAt(date: string, time: string) {
  return new Date(`${date}T${time}:00+09:00`);
}

function expandPhysicalSeatIds(seatId: string, members: SeatMemberRow[]) {
  const childIds = members
    .filter((m) => String(m.group_seat_id) === String(seatId))
    .map((m) => String(m.member_seat_id));

  return new Set(childIds.length > 0 ? childIds : [String(seatId)]);
}

function hasSeatConflict(a: Set<string>, b: Set<string>) {
  for (const id of a) {
    if (b.has(id)) return true;
  }
  return false;
}

function normalizePlanName(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/→.*$/, "")
    .replace(/【.*?】/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCourse(planNameRaw: string | null | undefined) {
  const planName = normalizePlanName(planNameRaw);

  if (planName.includes("Cコース") || planName.includes("11000") || planName.includes("11,000")) {
    return {
      courseName: "Cコース",
      coursePrice: 11000,
    };
  }

  if (planName.includes("Bコース") || planName.includes("8800") || planName.includes("8,800")) {
    return {
      courseName: "Bコース",
      coursePrice: 8800,
    };
  }

  if (planName.includes("Aコース") || planName.includes("6600") || planName.includes("6,600")) {
    return {
      courseName: "Aコース",
      coursePrice: 6600,
    };
  }

  return {
    courseName: planName || "席のみ",
    coursePrice: null,
  };
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

function isSixTableSeatName(name: string) {
  return name === "右6名席" || name === "左6名席";
}

function inferCounterOk(parsed: {
  seatLabel?: string | null;
  requestText?: string | null;
}) {
  const text = `${parsed.seatLabel ?? ""}\n${parsed.requestText ?? ""}`;
  return text.includes("カウンター");
}

async function findSeatCandidate(args: {
  storeId: string;
  persons: number;
  startAt: Date;
  duration: number;
  counterOk: boolean;
  excludeReservationId?: string | null;
}) {
  const { storeId, persons, startAt, duration, counterOk, excludeReservationId } = args;
  const endAt = addMinutes(startAt, duration);

  const [seatsRes, membersRes, reservationsRes] = await Promise.all([
    supabaseAdmin
      .from("seats")
      .select("*")
      .eq("store_id", storeId),

    supabaseAdmin
      .from("seat_members")
      .select("group_seat_id, member_seat_id"),

    supabaseAdmin
      .from("reservations")
      .select("*")
      .eq("store_id", storeId)
      .gte("start_at", addMinutes(startAt, -240).toISOString())
      .lte("start_at", addMinutes(endAt, 240).toISOString()),
  ]);

  if (seatsRes.error) throw seatsRes.error;
  if (membersRes.error) throw membersRes.error;
  if (reservationsRes.error) throw reservationsRes.error;

  const members = (membersRes.data ?? []) as SeatMemberRow[];

  const seats = ((seatsRes.data ?? []) as SeatRow[])
    .filter((s) => s.is_active !== false)
    .filter((s) => s.is_reservable !== false)
    .sort((a, b) => {
      const ao = Number(a.sort_order ?? 9999);
      const bo = Number(b.sort_order ?? 9999);
      if (ao !== bo) return ao - bo;
      return String(a.name).localeCompare(String(b.name), "ja");
    });

  const occupiedPhysicalSeatIds = new Set<string>();

  for (const r of reservationsRes.data ?? []) {
    if (!r.seat_id || !r.start_at) continue;
    if (excludeReservationId && String(r.id) === String(excludeReservationId)) continue;
    if (["cancelled", "finished", "no_show"].includes(String(r.status))) continue;

    const rStart = new Date(r.start_at);
    const rEnd = addMinutes(rStart, Number(r.duration_minutes ?? 120));

    if (!overlaps(startAt, endAt, rStart, rEnd)) continue;

    const reservedPhysicalSeatIds = expandPhysicalSeatIds(String(r.seat_id), members);
    for (const id of reservedPhysicalSeatIds) {
      occupiedPhysicalSeatIds.add(id);
    }
  }

  return (
    seats.find((seat) => {
      const seatName = String(seat.name ?? "");

      if (isPhysicalTableSeat(seatName)) return false;
      if (!counterOk && (isCounterSeat(seatName) || isCounterGroupSeat(seatName))) return false;
      if (persons <= 1 && isCounterGroupSeat(seatName)) return false;

      // 6名以上は6名席を候補から外して、8名席・全テーブル側に寄せる
      if (persons >= 6 && isSixTableSeatName(seatName)) return false;

      if (persons < minCap(seat) || persons > maxCap(seat)) return false;

      const candidatePhysicalSeatIds = expandPhysicalSeatIds(String(seat.id), members);

      if (hasSeatConflict(candidatePhysicalSeatIds, occupiedPhysicalSeatIds)) {
        return false;
      }

      return true;
    }) ?? null
  );
}

export async function importHotpepperReservationFromText(args: {
  rawText: string;
  messageId?: string | null;
}) {
  const parsed = parseHotpepperReservationMail(args.rawText);

  if (!parsed.externalId || !parsed.date || !parsed.time) {
    return {
      ok: false as const,
      reason: "required_fields_missing",
      parsed,
    };
  }

  const { data: store, error: storeError } = await supabaseAdmin
    .from("stores")
    .select("id, code")
    .eq("code", "steaklamp")
    .single();

  if (storeError || !store) {
    return {
      ok: false as const,
      reason: "store_not_found",
      error: storeError,
      parsed,
    };
  }

  const existingRes = await supabaseAdmin
    .from("reservations")
    .select("id, status, session_id")
    .eq("store_id", store.id)
    .eq("external_source", "hotpepper")
    .eq("external_reservation_id", parsed.externalId)
    .maybeSingle();

  if (existingRes.error) throw existingRes.error;

  if (parsed.mailType === "cancel") {
    if (!existingRes.data) {
      return {
        ok: true as const,
        skipped: true,
        reason: "cancel_target_not_found",
        parsed,
      };
    }

    const updateRes = await supabaseAdmin
      .from("reservations")
      .update({
        status: "cancelled",
        notes: [
          "ホットペッパー予約",
          "キャンセル通知を受信",
          parsed.planName ? `コース: ${parsed.planName}` : null,
          parsed.requestText ? `ご要望事項:\n${parsed.requestText}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      })
      .eq("id", existingRes.data.id)
      .select("id, status")
      .single();

    if (updateRes.error) throw updateRes.error;

    return {
      ok: true as const,
      skipped: false,
      action: "cancelled",
      reservation: updateRes.data,
      parsed,
    };
  }

  if (parsed.mailType !== "new") {
    return {
      ok: true as const,
      skipped: true,
      reason: "unsupported_mail_type",
      parsed,
    };
  }

  const persons = Number(parsed.persons ?? 0);
  if (!Number.isFinite(persons) || persons <= 0) {
    return {
      ok: false as const,
      reason: "invalid_persons",
      parsed,
    };
  }

  const startAt = buildStartAt(parsed.date, parsed.time);
  if (Number.isNaN(startAt.getTime())) {
    return {
      ok: false as const,
      reason: "invalid_start_at",
      parsed,
    };
  }

  if (startAt < new Date()) {
    return {
      ok: false as const,
      reason: "past_reservation",
      parsed,
    };
  }

  const duration = 120;
  const counterOk = inferCounterOk(parsed);
  const course = inferCourse(parsed.planName);

  const selectedSeat = await findSeatCandidate({
    storeId: store.id,
    persons,
    startAt,
    duration,
    counterOk,
    excludeReservationId: existingRes.data?.id ?? null,
  });

  if (!selectedSeat) {
    return {
      ok: false as const,
      reason: "seat_not_available",
      parsed,
      counterOk,
    };
  }

  const noteLines = [
    "ホットペッパー予約",
        parsed.seatLabel ? `席情報: ${parsed.seatLabel}` : null,
    parsed.planName ? `メールコース名: ${parsed.planName}` : null,
    parsed.questionAnswerText ? `苦手なもの・アレルギー:${parsed.questionAnswerText}` : null,
  parsed.requestText ? `ご要望事項:\n${parsed.requestText}` : null,

  ].filter(Boolean);

  const payload = {
    store_id: store.id,
    seat_id: selectedSeat.id,
    course_id: null,
    name: parsed.name || "ホットペッパー予約",
    phone: null,
    email: null,
    persons,
    start_at: startAt.toISOString(),
    duration_minutes: duration,
    course_name_snapshot: course.courseName,
    course_price_snapshot: course.coursePrice,
    counter_acceptable: counterOk,
    notes: noteLines.join("\n"),
    status: "booked",
    source: "hotpepper",
    cancel_token: null,
    external_source: "hotpepper",
    external_reservation_id: parsed.externalId,
    source_mail_message_id: args.messageId ?? null,
    imported_from_email: true,
  };

  if (existingRes.data) {
    const updateRes = await supabaseAdmin
      .from("reservations")
      .update({
        ...payload,
        session_id: existingRes.data.session_id ?? null,
      })
      .eq("id", existingRes.data.id)
      .select("id, status, name, start_at, seat_id")
      .single();

    if (updateRes.error) {
      return {
        ok: false as const,
        reason: "update_failed",
        parsed,
        error: updateRes.error,
      };
    }

    return {
      ok: true as const,
      skipped: false,
      action: "updated",
      reservation: updateRes.data,
      parsed,
      assignedSeatName: selectedSeat.name,
    };
  }

  const insertRes = await supabaseAdmin
    .from("reservations")
    .insert({
      ...payload,
      session_id: null,
    })
    .select("id, status, name, start_at, seat_id")
    .single();

  if (insertRes.error) {
    return {
      ok: false as const,
      reason: "insert_failed",
      parsed,
      error: insertRes.error,
    };
  }

  return {
    ok: true as const,
    skipped: false,
    action: "created",
    reservation: insertRes.data,
    parsed,
    assignedSeatName: selectedSeat.name,
  };
}
