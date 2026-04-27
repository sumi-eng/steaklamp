import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

type StoreRow = {
  id: string;
  code: string;
  name: string;
};

type SeatRow = {
  id: string;
  store_id: string;
  name: string;
  zone: string | null;
  seat_type: "table" | "group";
  capacity_min: number;
  capacity_max: number;
  is_active: boolean;
  is_reservable: boolean;
  sort_order: number;
};

type SeatMemberRow = {
  id: string;
  group_seat_id: string;
  member_seat_id: string;
};

type SeatRuleRow = {
  id: string;
  store_id: string;
  trigger_seat_id: string;
  affected_seat_id: string;
  rule_type: "block" | "allow_only_2_4" | "allow_only_2_6" | string;
  priority: number;
  note: string | null;
};

type ReservationRow = {
  id: string;
  store_id: string;
  seat_id: string | null;
  name: string;
  persons: number;
  start_at: string;
  duration_minutes: number;
  counter_acceptable: boolean;
  status: string;
  notes: string | null;
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
) {
  return aStart < bEnd && bStart < aEnd;
}

function parseAllowOnlyRange(ruleType: string): { min: number; max: number } | null {
  if (ruleType === "allow_only_2_4") return { min: 2, max: 4 };
  if (ruleType === "allow_only_2_6") return { min: 2, max: 6 };
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const name = String(body?.name ?? "").trim();
    const phone = body?.phone ? String(body.phone).trim() : null;
    const email = body?.email ? String(body.email).trim() : null;
    const persons = Number(body?.persons ?? 0);
    const seatId = String(body?.seat_id ?? "").trim();
    const startAtRaw = String(body?.start_at ?? "");
    const durationMinutes = Number(body?.duration_minutes ?? 120);
    const courseId =
      body?.course_id === null || body?.course_id === undefined || body?.course_id === ""
        ? null
        : String(body.course_id);
    const courseNameSnapshot =
      body?.course_name_snapshot === null || body?.course_name_snapshot === undefined || body?.course_name_snapshot === ""
        ? null
        : String(body.course_name_snapshot);
    const coursePriceSnapshot =
      body?.course_price_snapshot === null || body?.course_price_snapshot === undefined || body?.course_price_snapshot === ""
        ? null
        : Number(body.course_price_snapshot);
    const counterAcceptable = Boolean(body?.counter_acceptable ?? false);
    const notes = body?.notes ? String(body.notes).trim() : null;
    const source = body?.source ? String(body.source).trim() : "admin";
    const status = body?.status ? String(body.status).trim() : "booked";

    if (!name) {
      return json({ ok: false, error: "name_required" }, 400);
    }

    if (!Number.isFinite(persons) || persons <= 0) {
      return json({ ok: false, error: "invalid_persons" }, 400);
    }

    if (!seatId) {
      return json({ ok: false, error: "seat_id_required" }, 400);
    }

    if (!startAtRaw) {
      return json({ ok: false, error: "start_at_required" }, 400);
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return json({ ok: false, error: "invalid_duration_minutes" }, 400);
    }

    const requestedStart = new Date(startAtRaw);
    if (Number.isNaN(requestedStart.getTime())) {
      return json({ ok: false, error: "invalid_start_at" }, 400);
    }

    const requestedEnd = addMinutes(requestedStart, durationMinutes);

    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id, code, name")
      .eq("code", "steaklamp")
      .single();

    if (storeError || !store) {
      return json({ ok: false, error: "store_not_found" }, 404);
    }

    const { data: seats, error: seatsError } = await supabaseAdmin
      .from("seats")
      .select("*")
      .eq("store_id", store.id);

    if (seatsError) {
      return json(
        { ok: false, error: "load_seats_failed", detail: seatsError.message },
        500
      );
    }

    const { data: seatMembers, error: membersError } = await supabaseAdmin
      .from("seat_members")
      .select("id, group_seat_id, member_seat_id");

    if (membersError) {
      return json(
        { ok: false, error: "load_seat_members_failed", detail: membersError.message },
        500
      );
    }

    const { data: seatRules, error: rulesError } = await supabaseAdmin
      .from("seat_rules")
      .select("*")
      .eq("store_id", store.id)
      .order("priority", { ascending: true });

    if (rulesError) {
      return json(
        { ok: false, error: "load_seat_rules_failed", detail: rulesError.message },
        500
      );
    }

    const reservationFetchWindowStart = addMinutes(requestedStart, -720);
    const { data: reservations, error: reservationsError } = await supabaseAdmin
      .from("reservations")
      .select(
        "id, store_id, seat_id, name, persons, start_at, duration_minutes, counter_acceptable, status, notes"
      )
      .eq("store_id", store.id)
      .not("seat_id", "is", null)
      .in("status", ["booked", "confirmed", "seated"])
      .lt("start_at", requestedEnd.toISOString())
      .gte("start_at", reservationFetchWindowStart.toISOString());

    if (reservationsError) {
      return json(
        { ok: false, error: "load_reservations_failed", detail: reservationsError.message },
        500
      );
    }

    const seatRows = (seats ?? []) as SeatRow[];
    const memberRows = (seatMembers ?? []) as SeatMemberRow[];
    const ruleRows = (seatRules ?? []) as SeatRuleRow[];
    const reservationRows = (reservations ?? []) as ReservationRow[];

    const seatById = new Map<string, SeatRow>();
    for (const seat of seatRows) {
      seatById.set(seat.id, seat);
    }

    const targetSeat = seatById.get(seatId);
    if (!targetSeat || targetSeat.store_id !== store.id) {
      return json({ ok: false, error: "seat_not_found" }, 404);
    }

    if (!targetSeat.is_active || !targetSeat.is_reservable) {
      return json({ ok: false, error: "seat_not_reservable" }, 400);
    }

    const memberIdsByGroupSeatId = new Map<string, string[]>();
    for (const row of memberRows) {
      const arr = memberIdsByGroupSeatId.get(row.group_seat_id) ?? [];
      arr.push(row.member_seat_id);
      memberIdsByGroupSeatId.set(row.group_seat_id, arr);
    }

    function getPhysicalSeatIds(seatIdValue: string): string[] {
      const seat = seatById.get(seatIdValue);
      if (!seat) return [];
      if (seat.seat_type === "group") {
        return memberIdsByGroupSeatId.get(seatIdValue) ?? [];
      }
      return [seatIdValue];
    }

    const targetPhysicalSeatIds = getPhysicalSeatIds(targetSeat.id);
    const targetPhysicalSeatNames = targetPhysicalSeatIds
      .map((id) => seatById.get(id)?.name)
      .filter(Boolean) as string[];

    let effectiveMin = targetSeat.capacity_min;
    let effectiveMax = targetSeat.capacity_max;

    const overlappingReservations = reservationRows.filter((reservation) => {
      if (!reservation.seat_id) return false;
      const resStart = new Date(reservation.start_at);
      if (Number.isNaN(resStart.getTime())) return false;
      const resEnd = addMinutes(resStart, Number(reservation.duration_minutes ?? 0));
      return overlaps(requestedStart, requestedEnd, resStart, resEnd);
    });

    const activeRulesByTriggerSeatId = new Map<string, SeatRuleRow[]>();
    for (const rule of ruleRows) {
      const arr = activeRulesByTriggerSeatId.get(rule.trigger_seat_id) ?? [];
      arr.push(rule);
      activeRulesByTriggerSeatId.set(rule.trigger_seat_id, arr);
    }

    const appliedRules: Array<{
      trigger_seat_name: string;
      rule_type: string;
      note: string | null;
    }> = [];

    for (const reservation of overlappingReservations) {
      if (!reservation.seat_id) continue;

      const reservedPhysicalSeatIds = getPhysicalSeatIds(reservation.seat_id);
      const hasPhysicalConflict = targetPhysicalSeatIds.some((id) =>
        reservedPhysicalSeatIds.includes(id)
      );

      if (hasPhysicalConflict) {
        return json(
          {
            ok: false,
            error: "seat_conflict",
            detail: `重複予約あり: ${reservation.name}`,
            conflict_reservation: {
              id: reservation.id,
              name: reservation.name,
              seat_id: reservation.seat_id,
              seat_name: seatById.get(reservation.seat_id)?.name ?? null,
              start_at: reservation.start_at,
              duration_minutes: reservation.duration_minutes,
              persons: reservation.persons,
              status: reservation.status,
            },
          },
          409
        );
      }

      const triggeredRules = activeRulesByTriggerSeatId.get(reservation.seat_id) ?? [];
      for (const rule of triggeredRules) {
        if (rule.affected_seat_id !== targetSeat.id) continue;

        const triggerSeatName = seatById.get(rule.trigger_seat_id)?.name ?? "不明席";
        appliedRules.push({
          trigger_seat_name: triggerSeatName,
          rule_type: rule.rule_type,
          note: rule.note,
        });

        if (rule.rule_type === "block") {
          return json(
            {
              ok: false,
              error: "seat_blocked_by_rule",
              detail: `ルール制限: ${triggerSeatName}`,
              applied_rule: {
                trigger_seat_name: triggerSeatName,
                affected_seat_name: targetSeat.name,
                rule_type: rule.rule_type,
                note: rule.note,
              },
            },
            409
          );
        }

        const range = parseAllowOnlyRange(rule.rule_type);
        if (range) {
          effectiveMin = Math.max(effectiveMin, range.min);
          effectiveMax = Math.min(effectiveMax, range.max);
        }
      }
    }

    if (effectiveMin > effectiveMax) {
      return json(
        {
          ok: false,
          error: "rule_conflict",
          detail: "複数のルールが衝突しています。",
        },
        409
      );
    }

    if (persons < effectiveMin || persons > effectiveMax) {
      return json(
        {
          ok: false,
          error: "persons_out_of_range",
          detail: `${targetSeat.name} は ${effectiveMin}〜${effectiveMax}名対応です。`,
        },
        400
      );
    }

    if (coursePriceSnapshot !== null && !Number.isFinite(coursePriceSnapshot)) {
      return json(
        { ok: false, error: "invalid_course_price_snapshot" },
        400
      );
    }

    const insertPayload = {
      store_id: store.id,
      seat_id: targetSeat.id,
      course_id: courseId,
      name,
      phone,
      email,
      persons,
      start_at: requestedStart.toISOString(),
      duration_minutes: durationMinutes,
      course_name_snapshot: courseNameSnapshot,
      course_price_snapshot: coursePriceSnapshot,
      counter_acceptable: counterAcceptable,
      notes,
      status,
      source,
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("reservations")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError || !inserted) {
      return json(
        {
          ok: false,
          error: "insert_failed",
          detail: insertError?.message ?? "insert_failed",
        },
        500
      );
    }

    return json({
      ok: true,
      reservation: inserted,
      seat: {
        id: targetSeat.id,
        name: targetSeat.name,
        seat_type: targetSeat.seat_type,
        capacity_min: targetSeat.capacity_min,
        capacity_max: targetSeat.capacity_max,
        effective_capacity_min: effectiveMin,
        effective_capacity_max: effectiveMax,
        physical_seat_names: targetPhysicalSeatNames,
      },
      applied_rules: appliedRules,
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "reservation_create_failed",
        detail: e instanceof Error ? e.message : "unknown_error",
      },
      500
    );
  }
}
