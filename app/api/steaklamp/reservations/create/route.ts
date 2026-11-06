import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { sendLineReservationNotice } from "@/steaklamp/lib/lineNotify";
import { requireAdmin } from "@/steaklamp/lib/adminAuth";
import {
  isChristmasCourse,
  isChristmasDate,
  jstDateKey,
} from "@/steaklamp/lib/christmas";
import { afterChristmasReservationSaved } from "@/steaklamp/lib/christmas-server";
import { loadSeatLinks, replaceSeatLinks } from "@/steaklamp/lib/reservationSeats";
import {
  evaluateSeatSelection,
  normalizeSeatIds,
  seatLabelOf,
  type ReservationRow,
  type SeatMemberRow,
  type SeatRow,
} from "@/steaklamp/lib/inbound/seat-allocation";


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
  process.env.RESEND_FROM_EMAIL ??
  process.env.RESEND_FROM ??
  "Passion for Grilling Lamp <onboarding@resend.dev>";

 const storeEmail = process.env.STEAKLAMP_STORE_EMAIL ?? "lamp@japanblue.net";

console.log("STEAK MAIL FROM =", from);
console.log("STEAK MAIL STORE TO =", storeEmail);
console.log("STEAK MAIL CUSTOMER TO =", reservation.email);



 

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
    // 席の自由連結（seatIds が2席以上）はスタッフ（source:"admin"）だけが使える。先頭が代表席。
    let seatIds = normalizeSeatIds(body.seatIds);
    if (seatIds.length === 0 && body.seatId) seatIds = [String(body.seatId).trim()];
    const isLinked = seatIds.length > 1;
    const seatId = seatIds[0] ?? "";
    const confirmCapacityMismatch = body.confirmCapacityMismatch === true;
    const counterOk = Boolean(body.counterOk ?? false);

const source = String(body.source ?? "web");
const isAdminCreate = source === "admin";

// source:"admin" は受付期限・過去日のチェックを省略できる。
// 本文の自己申告だけでは認めず、管理者のログインがある場合だけ使えるようにする。
if (isAdminCreate) {
  const denied = await requireAdmin("reservations/create(source=admin)");
  if (denied) return denied;
}

// お客様の予約ページ（source:"web" など）から席の連結は受け付けない
if (isLinked && !isAdminCreate) {
  return json({ ok: false, error: "seat_link_admin_only" }, 403);
}


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

if (!isAdminCreate && startAt < now) {
  return json(
    { ok: false, error: "過去の日時には予約できません" },
    400
  );
}

if (!isAdminCreate) {

// ===== クリスマスコース対象日の制限 =====
// 12/24・25は通常コース・席のみを自社ページで受け付けない。
// クリスマスコースは専用の予約API（/api/steaklamp/christmas/reserve）からのみ受け付ける。
if (
  isChristmasDate(jstDateKey(startAt)) ||
  isChristmasCourse(String(courseName ?? ""))
) {
  return json(
    {
      ok: false,
      error: "この日のご予約はクリスマスコース専用ページからお願いいたします。",
    },
    400
  );
}

// ===== コース受付締切チェック =====
const courseNameText = String(courseName || "席のみ").trim();

const reservationDateKey = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(startAt);

function formatDateKey(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

let deadline: Date;

if (courseNameText === "Cコース") {
  const d = new Date(`${reservationDateKey}T00:00:00+09:00`);
  d.setDate(d.getDate() - 3);

  const key = formatDateKey(d);

  // Cコースは3日前23:59まで
  deadline = new Date(`${key}T23:59:59+09:00`);
} else {
  // 席のみ・A・Bは当日15:00まで
  deadline = new Date(`${reservationDateKey}T15:00:00+09:00`);
}

if (now > deadline) {
  return json(
    {
      ok: false,
      error:
        courseNameText === "Cコース"
          ? "Cコースは3日前までの受付です"
          : "席のみ・Aコース・Bコースは当日15時までの受付です",
    },
    400
  );
}

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


    const { data: seatRows, error: seatError } = await supabaseAdmin
      .from("seats")
      .select("*")
      .eq("store_id", store.id);

    if (seatError) {
      return json(
        { ok: false, error: "seat_not_found", detail: seatError.message },
        404
      );
    }

    const allSeats = (seatRows ?? []) as SeatRow[];
    const chosenSeats = seatIds.map((sid) => allSeats.find((s) => String(s.id) === sid));
    if (chosenSeats.some((s) => !s || (isLinked && s.is_active === false))) {
      return json({ ok: false, error: "seat_not_found" }, 404);
    }
    // 通知・メールの「お席」表示。連結なら「T1-1・T1-2・C3」
    const seat = { id: seatId, name: seatLabelOf(seatIds, allSeats) };

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

    let seatLinks;
    try {
      seatLinks = await loadSeatLinks((reservations ?? []).map((r: any) => r.id));
    } catch (e) {
      return json(
        { ok: false, error: "seat_links_load_failed", detail: e instanceof Error ? e.message : "unknown" },
        500
      );
    }

    // 選んだ席のどれか1つでも、同じ時間帯の他の予約と重なれば登録しない
    const evaluation = evaluateSeatSelection({
      seatIds,
      seats: allSeats,
      members,
      reservations: (reservations ?? []) as ReservationRow[],
      seatLinks,
      persons,
      startAt,
      duration,
    });

    if (evaluation.conflicts.length > 0) {
      return json(
        {
          ok: false,
          error: "この席はすでに予約されています",
        },
        400
      );
    }

    // 連結では、席が足りない・取りすぎのときはスタッフが確認したときだけ登録する
    if (isLinked && !evaluation.fitsPersons && !confirmCapacityMismatch) {
      return json(
        {
          ok: false,
          error: "persons_out_of_range",
          detail: evaluation.message ?? `${evaluation.label} は${persons}名には合わない席です。`,
        },
        409
      );
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
      source,
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

    if (isLinked) {
      try {
        await replaceSeatLinks(String(inserted.id), seatIds);
      } catch (linkError) {
        // 連結が保存できなかったら、席が足りない予約が残らないよう登録自体を取り消す
        console.error("save reservation_seats failed", linkError);
        await supabaseAdmin.from("reservations").delete().eq("id", inserted.id);
        return json(
          { ok: false, error: "seat_link_failed", detail: "席の連結の保存に失敗したため、予約を登録しませんでした。" },
          500
        );
      }
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

try {
  await sendLineReservationNotice({
    name: inserted.name,
    phone: inserted.phone,
    email: inserted.email,
    persons: inserted.persons,
    start_at: inserted.start_at,
    seatName: seat.name,
    courseName: inserted.course_name_snapshot,
    notes: inserted.notes,
    source: inserted.source ?? "web",
  });
} catch (lineError) {
  console.error("line notify failed", lineError);
}

// 電話予約（管理画面）で入れたクリスマスコースも残り枠に数え、満席・上限超過をLINEで知らせる
if (isChristmasCourse(inserted.course_name_snapshot)) {
  try {
    await afterChristmasReservationSaved({
      storeId: String(store.id),
      reservationId: String(inserted.id),
      sourceLabel: isAdminCreate ? "電話・管理画面" : "自社サイト",
    });
  } catch (christmasError) {
    console.error("christmas capacity notify failed", christmasError);
  }
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
