import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { sendLineReservationNotice } from "@/steaklamp/lib/lineNotify";


export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = String(body.token ?? "").trim();

    if (!token) {
      return json({ ok: false, error: "token_required" }, 400);
    }

    const { data: reservation, error: loadError } = await supabaseAdmin
      .from("reservations")
      .select("*")
      .eq("cancel_token", token)
      .single();

    if (loadError || !reservation) {
      return json({ ok: false, error: "予約情報が見つかりません。" }, 404);
    }

    if (reservation.status === "cancelled") {
      return json({
        ok: true,
        alreadyCancelled: true,
      });
    }

    const startAt = new Date(reservation.start_at);
    const now = new Date();

    const diffMs = startAt.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays < 2) {
      return json(
        {
          ok: false,
          error:
            "Webからのキャンセル期限を過ぎています。前日・当日はお電話にてお願いいたします。",
        },
        400
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("reservations")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservation.id)
      .select("*")
      .single();

    if (updateError) {
      return json(
        {
          ok: false,
          error: "キャンセルに失敗しました。",
          detail: updateError.message,
        },
        500
      );
    }

const { data: seat } = await supabaseAdmin
  .from("seats")
  .select("id, name")
  .eq("id", updated.seat_id)
  .maybeSingle();

try {
  await sendLineReservationNotice({
    name: updated.name,
    phone: updated.phone,
    email: updated.email,
    persons: updated.persons,
    start_at: updated.start_at,
    seatName: seat?.name ?? null,
    courseName: updated.course_name_snapshot,
    notes: updated.notes,
    source: "キャンセル",
  });
} catch (lineError) {
  console.error("line cancel notify failed", lineError);
}


    return json({
      ok: true,
      reservation: updated,
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
