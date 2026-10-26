import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import {
  evaluateSeatAssignment,
  maxCap,
  minCap,
  type ReservationRow,
  type SeatMemberRow,
  type SeatRow,
} from "@/steaklamp/lib/inbound/seat-allocation";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

const courseNameSnapshot = body.course_name_snapshot
  ? String(body.course_name_snapshot).trim()
  : null;

const coursePriceSnapshot =
  body.course_price_snapshot === null ||
  body.course_price_snapshot === undefined ||
  body.course_price_snapshot === ""
    ? null
    : Number(body.course_price_snapshot);


    const id = String(body.id ?? "").trim();
    const name = String(body.name ?? "").trim();
    const phone = body.phone ? String(body.phone).trim() : null;
    const email = body.email ? String(body.email).trim() : null;
    const persons = Number(body.persons ?? 0);
    const startAtRaw = String(body.startAt ?? "");
    const durationMinutes = Number(body.durationMinutes ?? 120);
    const notes = body.notes ? String(body.notes) : null;
const seatId = String(body.seatId ?? "").trim();
if (!seatId) return json({ ok: false, error: "seat_required" }, 400);


    if (!id) return json({ ok: false, error: "id_required" }, 400);
    if (!name) return json({ ok: false, error: "name_required" }, 400);
    if (!persons) return json({ ok: false, error: "persons_required" }, 400);
    if (!startAtRaw) return json({ ok: false, error: "start_at_required" }, 400);

    const startAt = new Date(startAtRaw);
    if (Number.isNaN(startAt.getTime())) {
      return json({ ok: false, error: "invalid_start_at" }, 400);
    }

    const confirmCapacityMismatch = body.confirmCapacityMismatch === true;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("reservations")
      .select("id, store_id, seat_id, persons, start_at, duration_minutes, assignment_status")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      return json({ ok: false, error: "reservation_not_found" }, 404);
    }

    const seatChanged = String(existing.seat_id ?? "") !== seatId;
    const timeChanged =
      new Date(existing.start_at).getTime() !== startAt.getTime() ||
      Number(existing.duration_minutes ?? 120) !== durationMinutes;
    const personsChanged = Number(existing.persons ?? 0) !== persons;

    // 席・日時・滞在分数・人数のいずれかが変わるときだけ、席の空きと定員を確認する
    // （席も日時も変えない備考の編集などを、既存の席の状態で止めないため）
    if (seatChanged || timeChanged || personsChanged) {
      const [seatsRes, membersRes, reservationsRes] = await Promise.all([
        supabaseAdmin.from("seats").select("*").eq("store_id", existing.store_id),
        supabaseAdmin.from("seat_members").select("group_seat_id, member_seat_id"),
        supabaseAdmin
          .from("reservations")
          .select("id, name, seat_id, start_at, duration_minutes, status")
          .eq("store_id", existing.store_id)
          .gte("start_at", new Date(startAt.getTime() - 720 * 60_000).toISOString())
          .lte("start_at", new Date(startAt.getTime() + (durationMinutes + 720) * 60_000).toISOString()),
      ]);

      if (seatsRes.error || membersRes.error || reservationsRes.error) {
        return json({ ok: false, error: "seat_check_failed" }, 500);
      }

      const seat = ((seatsRes.data ?? []) as SeatRow[]).find((s) => String(s.id) === seatId);
      if (!seat || seat.is_active === false) {
        return json({ ok: false, error: "seat_not_found" }, 404);
      }

      const { fitsPersons, conflicts } = evaluateSeatAssignment({
        seat,
        members: (membersRes.data ?? []) as SeatMemberRow[],
        reservations: (reservationsRes.data ?? []) as ReservationRow[],
        persons,
        startAt,
        duration: durationMinutes,
        excludeReservationId: id,
      });

      // 他の予約と重なる席には変更できない
      if (conflicts.length > 0) {
        const c = conflicts[0];
        return json(
          {
            ok: false,
            error: "seat_conflict",
            detail: `${seat.name} はこの時間帯に別の予約があります（${c.name ?? "予約"}様）。先にそちらの予約の席を変更してください。`,
            conflict_reservation: { id: c.id, name: c.name, start_at: c.start_at },
          },
          409
        );
      }

      // 人数が定員から外れる席は、スタッフが確認したときだけ変更できる
      if (!fitsPersons && !confirmCapacityMismatch) {
        return json(
          {
            ok: false,
            error: "persons_out_of_range",
            detail: `${seat.name} は ${minCap(seat)}〜${maxCap(seat)}名の席です（${persons}名）。`,
          },
          409
        );
      }
    }

    // 席を手動で選んだ（または割り当て待ちだった）予約は「割り当て済み」にして、席未割当の警告を消す
    const assignmentUpdate =
      seatChanged || existing.assignment_status !== "assigned"
        ? { assignment_status: "assigned", warning_message: null }
        : {};

    const { data, error } = await supabaseAdmin
      .from("reservations")
      .update({
        ...assignmentUpdate,
        name,
seat_id: seatId,

        phone,
        email,
        persons,
        start_at: startAt.toISOString(),
        duration_minutes: durationMinutes,
        notes,
course_name_snapshot: courseNameSnapshot,
course_price_snapshot: coursePriceSnapshot,

        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return json({ ok: false, error: "update_failed", detail: error.message }, 500);
    }

    return json({ ok: true, reservation: data });
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
