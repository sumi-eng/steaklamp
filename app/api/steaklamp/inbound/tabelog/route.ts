import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { parseTabelogReservationMail } from "@/steaklamp/lib/inbound/tabelog-parser";

export const runtime = "nodejs";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
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

function isCounterSeatName(name: string) {
  return /^C\d+$/.test(name) || /^C-\d+/.test(name);
}

function expandPhysicalSeatIds(seatId: string, members: any[]) {
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

function buildStartAt(date: string, time: string) {
  return new Date(`${date}T${time}:00+09:00`);
}

function buildNotes(parsed: any) {
  return [
    parsed.planName ? `メールコース名: ${parsed.planName}` : null,
    parsed.seatLabel ? `食べログ席情報: ${parsed.seatLabel}` : null,
    parsed.requestText ? `ご要望事項: ${parsed.requestText}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function findAvailableSeat(args: {
  storeId: string;
  persons: number;
  startAt: Date;
  duration: number;
  seatLabel: string;
}) {
  const { storeId, persons, startAt, duration, seatLabel } = args;
  const endAt = addMinutes(startAt, duration);

  const { data: seats, error: seatsError } = await supabaseAdmin
    .from("seats")
    .select("*")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true });

  if (seatsError) throw seatsError;

  const { data: seatMembers, error: seatMembersError } = await supabaseAdmin
    .from("seat_members")
    .select("group_seat_id, member_seat_id");

  if (seatMembersError) throw seatMembersError;

  const members = seatMembers ?? [];

  const { data: reservations, error: reservationsError } = await supabaseAdmin
    .from("reservations")
    .select("id, seat_id, start_at, duration_minutes, status")
    .eq("store_id", storeId)
    .gte("start_at", addMinutes(startAt, -240).toISOString())
    .lte("start_at", addMinutes(endAt, 240).toISOString());

  if (reservationsError) throw reservationsError;

  const occupiedPhysicalSeatIds = new Set<string>();

  for (const r of reservations ?? []) {
    if (!r.seat_id || !r.start_at) continue;
    if (["cancelled", "finished", "no_show"].includes(String(r.status))) continue;

    const rStart = new Date(r.start_at);
    const rEnd = addMinutes(rStart, Number(r.duration_minutes ?? 120));

    if (!overlaps(startAt, endAt, rStart, rEnd)) continue;

    const physicalIds = expandPhysicalSeatIds(String(r.seat_id), members);
    for (const id of physicalIds) {
      occupiedPhysicalSeatIds.add(id);
    }
  }

  const wantsCounter = seatLabel.includes("カウンター");

  const candidates = (seats ?? [])
    .filter((seat: any) => seat.is_active !== false)
    .filter((seat: any) => seat.is_reservable !== false)
    .filter((seat: any) => {
      const name = String(seat.name ?? "");

      if (isPhysicalTableSeat(name)) return false;
      if (persons < minCap(seat) || persons > maxCap(seat)) return false;

      const physicalIds = expandPhysicalSeatIds(String(seat.id), members);
      if (hasSeatConflict(physicalIds, occupiedPhysicalSeatIds)) return false;

      return true;
    })
    .sort((a: any, b: any) => {
      const an = String(a.name ?? "");
      const bn = String(b.name ?? "");

      if (wantsCounter) {
        const ac = isCounterSeatName(an) ? 0 : 1;
        const bc = isCounterSeatName(bn) ? 0 : 1;
        if (ac !== bc) return ac - bc;
      }

      return Number(a.sort_order ?? 9999) - Number(b.sort_order ?? 9999);
    });

  return candidates[0] ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      return json({ ok: false, error: "RESEND_API_KEY is not configured" }, 500);
    }

    const resend = new Resend(apiKey);
    const event = await req.json().catch(() => ({} as any));

    console.log("STEAKLAMP_TABELOG_INBOUND_EVENT =", JSON.stringify(event));

    if (event?.type !== "email.received") {
      return json({ ok: true, ignored: true, reason: "not_email_received" });
    }

    const emailId =
      event?.data?.email_id ??
      event?.data?.id ??
      event?.email_id ??
      event?.id;

    if (!emailId) {
      return json({ ok: false, error: "email_id not found" }, 400);
    }

    const { data: receivedEmail, error: receivedError } =
      await resend.emails.receiving.get(String(emailId));

    if (receivedError) {
      console.error("STEAKLAMP_TABELOG_RECEIVED_GET_ERROR =", receivedError);
      return json({ ok: false, error: receivedError.message }, 500);
    }

    const textBody = String(receivedEmail?.text || receivedEmail?.html || "").trim();

    if (!textBody) {
      return json({ ok: true, ignored: true, reason: "empty_email_body" });
    }

    if (!textBody.includes("食べログ")) {
      return json({ ok: true, ignored: true, reason: "not_tabelog_mail" });
    }

    const parsed = parseTabelogReservationMail(textBody);

    console.log("STEAKLAMP_TABELOG_PARSED =", JSON.stringify(parsed, null, 2));

    if (parsed.mailType !== "new") {
      return json({
        ok: true,
        ignored: true,
        reason: "unsupported_mail_type",
        parsed,
      });
    }

    if (!parsed.externalId || !parsed.date || !parsed.time || !parsed.persons) {
      return json({
        ok: false,
        reason: "required_fields_missing",
        parsed,
      });
    }

    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id, code")
      .eq("code", "steaklamp")
      .single();

    if (storeError || !store) {
      return json(
        { ok: false, error: "store_not_found", detail: storeError?.message },
        500
      );
    }

    const existingRes = await supabaseAdmin
      .from("reservations")
      .select("id, session_id")
      .eq("store_id", store.id)
      .eq("external_source", "tabelog")
      .eq("external_reservation_id", parsed.externalId)
      .maybeSingle();

    if (existingRes.error) throw existingRes.error;

    const startAt = buildStartAt(parsed.date, parsed.time);
    const duration = Number(parsed.durationMinutes ?? 120);

    const selectedSeat = await findAvailableSeat({
      storeId: store.id,
      persons: parsed.persons,
      startAt,
      duration,
      seatLabel: parsed.seatLabel ?? "",
    });

    if (!selectedSeat) {
      return json({
        ok: false,
        reason: "seat_not_available",
        parsed,
      });
    }

    const payload = {
      store_id: store.id,
      seat_id: selectedSeat.id,
      course_id: null,

      name: parsed.name || "食べログ予約",
      phone: parsed.phone || null,
      email: null,
      persons: parsed.persons,

      start_at: startAt.toISOString(),
      duration_minutes: duration,

      course_name_snapshot: parsed.planName || "お席のみのご予約",
      course_price_snapshot: 0,

      notes: buildNotes(parsed),
      status: "booked",
      source: "tabelog",

      external_source: "tabelog",
      external_reservation_id: parsed.externalId,
      source_mail_message_id:
        (receivedEmail as any)?.headers?.["message-id"] ??
        (receivedEmail as any)?.messageId ??
        null,
      imported_from_email: true,

      session_id: existingRes.data?.session_id ?? null,
    };

    console.log("STEAKLAMP_TABELOG_PAYLOAD =", JSON.stringify(payload, null, 2));

    if (existingRes.data) {
      const { data, error } = await supabaseAdmin
        .from("reservations")
        .update(payload)
        .eq("id", existingRes.data.id)
        .select("id, name, start_at, status")
        .single();

      if (error) {
        console.error("STEAKLAMP_TABELOG_UPDATE_ERROR =", error);
        return json({ ok: false, reason: "update_failed", error, parsed }, 500);
      }

      return json({ ok: true, action: "updated", reservation: data, parsed });
    }

    const { data, error } = await supabaseAdmin
      .from("reservations")
      .insert(payload)
      .select("id, name, start_at, status")
      .single();

    if (error) {
      console.error("STEAKLAMP_TABELOG_INSERT_ERROR =", error);
      return json({ ok: false, reason: "insert_failed", error, parsed }, 500);
    }

    return json({ ok: true, action: "created", reservation: data, parsed });
  } catch (e: any) {
    console.error("STEAKLAMP_TABELOG_FATAL =", e);
    return json({ ok: false, error: e?.message ?? String(e) }, 500);
  }
}
