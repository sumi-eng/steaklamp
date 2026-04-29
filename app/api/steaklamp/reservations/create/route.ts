import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function createCancelToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function toJstDate(raw: string) {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  // すでに Z や +09:00 が付いている場合はそのまま
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) {
    return new Date(value);
  }

  // 2026-04-30T19:00 → 2026-04-30T19:00:00+09:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value}:00+09:00`);
  }

  // 2026-04-30T19:00:00 → 2026-04-30T19:00:00+09:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value}+09:00`);
  }

  return new Date(value);
}


function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function formatDateTimeJp(value: string) {
  const d = new Date(value);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SeatMemberRow = {
  group_seat_id: string;
  member_seat_id: string;
};

// 親席IDではなく、実際に使う物理席IDだけに展開する
function expandPhysicalSeatIds(seatId: string, members: SeatMemberRow[]) {
  const childIds = members
    .filter((m) => String(m.group_seat_id) === String(seatId))
    .map((m) => String(m.member_seat_id));

  if (childIds.length > 0) {
    return new Set(childIds);
  }

  return new Set([String(seatId)]);
}

function hasSeatConflict(a: Set<string>, b: Set<string>) {
  for (const id of a) {
    if (b.has(id)) return true;
  }
  return false;
}

function formatPrice(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n.toLocaleString()}円`;
}

async function sendReservationEmails({
  reservation,
  cancelToken,
  seatName,
}: {
  reservation: any;
  cancelToken: string;
  seatName?: string | null;
}) {
  if (!resend) return;

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://steaklamp-m2og.vercel.app";

  const cancelUrl = `${siteUrl}/steaklamp/reserve/cancel?token=${cancelToken}`;

  const from =
    process.env.STEAKLAMP_FROM_EMAIL ??
    "Passion for Grilling Lamp <lamp@japanblue.net>";

  const storeEmail = process.env.STEAKLAMP_STORE_EMAIL ?? "lamp@japanblue.net";

  const dateText = formatDateTimeJp(reservation.start_at);

  const courseName = reservation.course_name_snapshot || "席のみ";
  const coursePrice = reservation.course_price_snapshot
    ? formatPrice(reservation.course_price_snapshot)
    : "";

  const courseText = coursePrice ? `${courseName}（${coursePrice}）` : courseName;
  const notesText = reservation.notes || "なし";

  const customerHtml = `
    <div style="font-family: sans-serif; line-height: 1.8; color: #222;">
      <h2>【Passion for Grilling Lamp】ご予約ありがとうございます</h2>

      <p>${reservation.name} 様</p>

      <p>以下の内容でご予約を承りました。</p>

      <table style="border-collapse: collapse; line-height: 1.8;">
        <tr><td style="padding-right:16px;">日時</td><td>${dateText}</td></tr>
        <tr><td style="padding-right:16px;">人数</td><td>${reservation.persons}名</td></tr>
        <tr><td style="padding-right:16px;">内容</td><td>${courseText}</td></tr>
        <tr><td style="padding-right:16px;">お席</td><td>${seatName ?? ""}</td></tr>
        <tr><td style="padding-right:16px;">電話</td><td>${reservation.phone ?? ""}</td></tr>
        <tr><td style="padding-right:16px;">備考</td><td>${notesText}</td></tr>
      </table>

      <p style="margin-top:24px;">
        キャンセルはこちらからお願いいたします。<br />
        <a href="${cancelUrl}">${cancelUrl}</a>
      </p>

      <p style="font-size:13px; color:#666;">
        Webからのキャンセルは2日前まで承っております。<br />
        前日・当日の変更やキャンセルはお電話にてお願いいたします。
      </p>
    </div>
  `;

  const storeHtml = `
    <div style="font-family: sans-serif; line-height: 1.8; color: #222;">
      <h2>【Passion for Grilling Lamp】新しい予約が入りました</h2>

      <table style="border-collapse: collapse; line-height: 1.8;">
        <tr><td style="padding-right:16px;">名前</td><td>${reservation.name}</td></tr>
        <tr><td style="padding-right:16px;">日時</td><td>${dateText}</td></tr>
        <tr><td style="padding-right:16px;">人数</td><td>${reservation.persons}名</td></tr>
        <tr><td style="padding-right:16px;">内容</td><td>${courseText}</td></tr>
        <tr><td style="padding-right:16px;">お席</td><td>${seatName ?? ""}</td></tr>
        <tr><td style="padding-right:16px;">電話</td><td>${reservation.phone ?? ""}</td></tr>
        <tr><td style="padding-right:16px;">メール</td><td>${reservation.email ?? ""}</td></tr>
        <tr><td style="padding-right:16px;">備考</td><td>${notesText}</td></tr>
      </table>

      <p style="margin-top:24px;">
        キャンセルURL：<br />
        <a href="${cancelUrl}">${cancelUrl}</a>
      </p>
    </div>
  `;

  if (reservation.email) {
    await resend.emails.send({
      from,
      to: reservation.email,
      subject: "【Passion for Grilling Lamp】ご予約を承りました",
      html: customerHtml,
    });
  }

  if (storeEmail) {
    await resend.emails.send({
      from,
      to: storeEmail,
      subject: "【Passion for Grilling Lamp】新しい予約が入りました",
      html: storeHtml,
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const phoneDigits = phone.replace(/[^\d]/g, "");

    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      return json(
        {
          ok: false,
          error: "電話番号は10桁または11桁で入力してください",
        },
        400
      );
    }

    const email = body.email ? String(body.email).trim() : null;
    const persons = Number(body.persons ?? 0);
    const startAtRaw = String(body.startAt ?? "");
    const duration = Number(body.duration ?? 120);
    const notes = body.notes ? String(body.notes) : null;
    const seatId = String(body.seatId ?? "");
    const counterOk = Boolean(body.counterOk ?? false);

    const courseId = body.course_id ?? null;
    const courseName = body.course_name_snapshot ?? null;
    const coursePrice = body.course_price_snapshot ?? null;

    if (!name || !phone || !persons || !startAtRaw || !seatId) {
      return json({ ok: false, error: "missing_params" }, 400);
    }

    const startAt = toJstDate(startAtRaw);

if (!startAt || Number.isNaN(startAt.getTime())) {
  return json({ ok: false, error: "invalid_startAt", startAtRaw }, 400);
}


const now = new Date();

if (startAt < now) {
  return json(
    { ok: false, error: "過去の日時には予約できません" },
    400
  );
}


    const endAt = addMinutes(startAt, duration);

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

// ===== 休業日チェック =====
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
  return json(
    {
      ok: false,
      error: "この日は休業日のため予約できません",
      reason: closure.reason,
    },
    400
  );
}


    const { data: seat, error: seatError } = await supabaseAdmin
      .from("seats")
      .select("id, name")
      .eq("id", seatId)
      .single();

    if (seatError || !seat) {
      return json(
        { ok: false, error: "seat_not_found", detail: seatError?.message },
        404
      );
    }

    const { data: reservations, error: reservationsError } = await supabaseAdmin
      .from("reservations")
      .select("*")
      .eq("store_id", store.id)
      .gte("start_at", addMinutes(startAt, -240).toISOString())
      .lte("start_at", addMinutes(endAt, 240).toISOString());

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

    const members = (seatMembers ?? []) as SeatMemberRow[];
    const targetPhysicalSeatIds = expandPhysicalSeatIds(seatId, members);

    for (const r of reservations ?? []) {
      if (!r.start_at || !r.seat_id) continue;
      if (["cancelled", "finished", "no_show"].includes(String(r.status))) {
        continue;
      }

      const rStart = new Date(r.start_at);
      const rEnd = addMinutes(rStart, Number(r.duration_minutes ?? 120));

      if (!overlaps(startAt, endAt, rStart, rEnd)) continue;

      const reservedPhysicalSeatIds = expandPhysicalSeatIds(
        String(r.seat_id),
        members
      );

      if (hasSeatConflict(targetPhysicalSeatIds, reservedPhysicalSeatIds)) {
        return json(
          {
            ok: false,
            error: "この席はすでに予約されています",
          },
          400
        );
      }
    }

    const cancelToken = createCancelToken();

    const insertPayload = {
      store_id: store.id,
      seat_id: seatId,
      course_id: courseId,
      name,
      phone,
      email,
      persons,
      start_at: startAt.toISOString(),
      duration_minutes: duration,
      course_name_snapshot: courseName,
      course_price_snapshot: coursePrice,
      counter_acceptable: counterOk,
      notes,
      status: "booked",
      source: "web",
      cancel_token: cancelToken,
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("reservations")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError) {
      return json(
        {
          ok: false,
          error: "insert_failed",
          detail: insertError.message,
        },
        500
      );
    }

    try {
      await sendReservationEmails({
        reservation: inserted,
        cancelToken,
        seatName: seat.name,
      });
    } catch (mailError) {
      console.error("reservation email failed", mailError);
    }

    return json({
      ok: true,
      reservation: inserted,
      cancelToken,
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
