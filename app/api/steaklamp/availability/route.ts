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

type EffectiveRange = {
  min: number;
  max: number;
  source: string;
};

function isCounterSeatName(name: string) {
  return name.startsWith("C");
}

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

    const persons = Number(body?.persons ?? 0);
    const startAtRaw = String(body?.start_at ?? "");
    const durationMinutes = Number(body?.duration_minutes ?? 120);
    const counterOk = Boolean(body?.counter_ok ?? false);

    if (!Number.isFinite(persons) || persons <= 0) {
      return json({ ok: false, error: "invalid_persons" }, 400);
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
      .eq("store_id", store.id)
      .eq("is_active", true)
      .eq("is_reservable", true)
      .order("sort_order", { ascending: true });

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

    const memberIdsByGroupSeatId = new Map<string, string[]>();
    for (const row of memberRows) {
      const arr = memberIdsByGroupSeatId.get(row.group_seat_id) ?? [];
      arr.push(row.member_seat_id);
      memberIdsByGroupSeatId.set(row.group_seat_id, arr);
    }

    function getPhysicalSeatIds(seatId: string): string[] {
      const seat = seatById.get(seatId);
      if (!seat) return [];

      if (seat.seat_type === "group") {
        return memberIdsByGroupSeatId.get(seatId) ?? [];
      }

      return [seatId];
    }

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

    const available: Array<{
      id: string;
      name: string;
      seat_type: string;
      capacity_min: number;
      capacity_max: number;
      effective_capacity_min: number;
      effective_capacity_max: number;
      physical_seat_names: string[];
      applied_rules: Array<{
        trigger_seat_name: string;
        rule_type: string;
        note: string | null;
      }>;
    }> = [];

    const unavailable: Array<{
      id: string;
      name: string;
      reason: string;
      detail?: string;
    }> = [];

    for (const candidate of seatRows) {
      const candidateIsCounter = isCounterSeatName(candidate.name);

      if (!counterOk && candidateIsCounter) {
        unavailable.push({
          id: candidate.id,
          name: candidate.name,
          reason: "counter_not_allowed",
          detail: "今回の条件ではカウンター席不可です。",
        });
        continue;
      }

      const candidatePhysicalSeatIds = getPhysicalSeatIds(candidate.id);
      const candidatePhysicalSeatNames = candidatePhysicalSeatIds
        .map((id) => seatById.get(id)?.name)
        .filter(Boolean) as string[];

      let blocked = false;
      let blockReason = "";
      let allowRanges: EffectiveRange[] = [];
      let appliedRules: Array<{
        trigger_seat_name: string;
        rule_type: string;
        note: string | null;
      }> = [];

      for (const reservation of overlappingReservations) {
        if (!reservation.seat_id) continue;

        const reservedPhysicalSeatIds = getPhysicalSeatIds(reservation.seat_id);
        const hasPhysicalConflict = candidatePhysicalSeatIds.some((id) =>
          reservedPhysicalSeatIds.includes(id)
        );

        if (hasPhysicalConflict) {
          blocked = true;
          blockReason = `重複予約あり: ${reservation.name}`;
          break;
        }

        const triggeredRules = activeRulesByTriggerSeatId.get(reservation.seat_id) ?? [];
        for (const rule of triggeredRules) {
          if (rule.affected_seat_id !== candidate.id) continue;

          const triggerSeatName = seatById.get(rule.trigger_seat_id)?.name ?? "不明席";
          appliedRules.push({
            trigger_seat_name: triggerSeatName,
            rule_type: rule.rule_type,
            note: rule.note,
          });

          if (rule.rule_type === "block") {
            blocked = true;
            blockReason = `ルール制限: ${triggerSeatName}`;
            break;
          }

          const range = parseAllowOnlyRange(rule.rule_type);
          if (range) {
            allowRanges.push({
              min: range.min,
              max: range.max,
              source: triggerSeatName,
            });
          }
        }

        if (blocked) break;
      }

      if (blocked) {
        unavailable.push({
          id: candidate.id,
          name: candidate.name,
          reason: "blocked",
          detail: blockReason,
        });
        continue;
      }

      let effectiveMin = candidate.capacity_min;
      let effectiveMax = candidate.capacity_max;

      if (allowRanges.length > 0) {
        effectiveMin = allowRanges[0].min;
        effectiveMax = allowRanges[0].max;

        for (const range of allowRanges.slice(1)) {
          effectiveMin = Math.max(effectiveMin, range.min);
          effectiveMax = Math.min(effectiveMax, range.max);
        }
      }

      if (effectiveMin > effectiveMax) {
        unavailable.push({
          id: candidate.id,
          name: candidate.name,
          reason: "rule_conflict",
          detail: "複数ルールが衝突しています。",
        });
        continue;
      }

      if (persons < effectiveMin || persons > effectiveMax) {
        unavailable.push({
          id: candidate.id,
          name: candidate.name,
          reason: "persons_out_of_range",
          detail: `${effectiveMin}〜${effectiveMax}名対応`,
        });
        continue;
      }

      available.push({
        id: candidate.id,
        name: candidate.name,
        seat_type: candidate.seat_type,
        capacity_min: candidate.capacity_min,
        capacity_max: candidate.capacity_max,
        effective_capacity_min: effectiveMin,
        effective_capacity_max: effectiveMax,
        physical_seat_names: candidatePhysicalSeatNames,
        applied_rules: appliedRules,
      });
    }

    return json({
      ok: true,
      request: {
        persons,
        start_at: requestedStart.toISOString(),
        duration_minutes: durationMinutes,
        counter_ok: counterOk,
      },
      store: store as StoreRow,
      available,
      unavailable,
      overlapping_reservations: overlappingReservations.map((reservation) => ({
        id: reservation.id,
        name: reservation.name,
        seat_id: reservation.seat_id,
        seat_name: reservation.seat_id
          ? seatById.get(reservation.seat_id)?.name ?? null
          : null,
        persons: reservation.persons,
        start_at: reservation.start_at,
        duration_minutes: reservation.duration_minutes,
        status: reservation.status,
      })),
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "availability_failed",
        detail: e instanceof Error ? e.message : "unknown_error",
      },
      500
    );
  }
}
