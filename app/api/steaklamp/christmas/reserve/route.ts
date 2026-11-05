import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { sendLineReservationNotice } from "@/steaklamp/lib/lineNotify";
import { sendChristmasConfirmationEmails } from "@/steaklamp/lib/christmas-mail";
import {
  CHRISTMAS,
  CHRISTMAS_PRICE_TEXT,
  evaluateRegistrationOrder,
  jstDateKey,
  summarizeDay,
  validateChristmasGuest,
  validateChristmasRequest,
} from "@/steaklamp/lib/christmas";
import {
  afterChristmasReservationSaved,
  getSteaklampStoreId,
  loadChristmasRows,
  loadClosedDates,
} from "@/steaklamp/lib/christmas-server";
import { findSeat } from "@/steaklamp/lib/inbound/hotpepper-import";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function fail(error: string, status = 400) {
  return json({ ok: false, error }, status);
}

function createCancelToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const date = String(body.date ?? "").trim();
    const time = String(body.time ?? "").trim();
    const persons = Number(body.persons ?? 0);
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const email = String(body.email ?? "").trim();
    const allergy = String(body.allergy ?? "").trim();
    const agreed = body.agreedToCancelPolicy === true;

    const guestError = validateChristmasGuest({ name, phone, email, allergy, agreed });
    if (guestError) return fail(guestError);

    const storeId = await getSteaklampStoreId();

    // 休業日
    const { data: closure, error: closureError } = await supabaseAdmin
      .from("store_closures")
      .select("id")
      .eq("store_id", storeId)
      .eq("closed_on", date)
      .maybeSingle();
    if (closureError) return fail("休業日の確認に失敗しました。", 500);
    if (closure) return fail("この日はご予約を受け付けておりません。");

    const [rows, closedDates] = await Promise.all([
      loadChristmasRows(storeId),
      loadClosedDates(),
    ]);
    const summary = summarizeDay(rows, date, closedDates.has(date));

    const check = validateChristmasRequest({
      now: new Date(),
      date,
      time,
      persons,
      summary,
    });
    if (!check.ok) return fail(check.reason, 409);

    const startAt = new Date(`${date}T${time}:00+09:00`);
    if (Number.isNaN(startAt.getTime()) || startAt.getTime() < Date.now()) {
      return fail("過去の日時には予約できません。");
    }

    // 席が取れない時刻は受け付けない（席未割当の予約を自社ページで作らない）
    const choice = await findSeat({
      storeId,
      persons,
      startAt,
      duration: CHRISTMAS.durationMinutes,
      counterOk: false,
    });
    if (!choice.seat) {
      return fail("申し訳ありません。この時間は満席です。別の時間をお選びください。", 409);
    }

    const cancelToken = createCancelToken();
    const agreedAt = new Date().toISOString();
    const notes = [
      `${CHRISTMAS.courseName}（自社サイト）`,
      `アレルギー・苦手な食材: ${allergy}`,
      "キャンセルポリシーに同意済み",
    ].join("\n");

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("reservations")
      .insert({
        store_id: storeId,
        seat_id: choice.seat.id,
        course_id: null,
        name,
        phone,
        email,
        persons,
        start_at: startAt.toISOString(),
        duration_minutes: CHRISTMAS.durationMinutes,
        course_name_snapshot: CHRISTMAS.courseName,
        course_price_snapshot: CHRISTMAS.price,
        counter_acceptable: false,
        notes,
        status: "booked",
        source: "web",
        cancel_token: cancelToken,
        cancel_policy_agreed_at: agreedAt,
        assignment_status: "assigned",
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      return json(
        { ok: false, error: "予約の登録に失敗しました。", detail: insertError?.message },
        500
      );
    }

    // 同時に申込があった場合：自分より先に登録された予約だけを数えて上限を判定する。
    // 超えていたら、後から来たこの予約だけを取り消して満席として返す。
    const afterRows = await loadChristmasRows(storeId);
    const mine = afterRows.find((r) => String(r.id) === String(inserted.id));
    const order = mine
      ? evaluateRegistrationOrder(afterRows, mine, jstDateKey(inserted.start_at))
      : null;

    if (order?.over) {
      await supabaseAdmin
        .from("reservations")
        .update({
          status: "cancelled",
          notes: `${notes}\n同時申込により上限超過のため自動で取り消し`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inserted.id);
      return fail("申し訳ありません。ちょうど満席になりました。", 409);
    }

    try {
      await sendLineReservationNotice({
        name: inserted.name,
        phone: inserted.phone,
        email: inserted.email,
        persons: inserted.persons,
        start_at: inserted.start_at,
        seatName: choice.seat.name,
        courseName: `${CHRISTMAS.courseName}（${CHRISTMAS_PRICE_TEXT}）`,
        notes: inserted.notes,
        source: "web",
      });
    } catch (e) {
      console.error("christmas line notify failed", e);
    }

    try {
      await afterChristmasReservationSaved({
        storeId,
        reservationId: String(inserted.id),
        sourceLabel: "自社サイト",
      });
    } catch (e) {
      console.error("christmas capacity notify failed", e);
    }

    try {
      await sendChristmasConfirmationEmails({
        reservation: inserted,
        cancelToken,
        allergy,
      });
    } catch (e) {
      console.error("christmas email failed", e);
    }

    return json({
      ok: true,
      reservation: {
        id: inserted.id,
        start_at: inserted.start_at,
        persons: inserted.persons,
      },
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
