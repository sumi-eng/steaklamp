import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { sendLineReservationNotice } from "@/steaklamp/lib/lineNotify";
import { findSeatCandidate } from "./hotpepper-import";
import { parseIkyuReservationMail } from "./ikyu-parser";

function buildStartAt(date: string, time: string) {
  return new Date(`${date}T${time}:00+09:00`);
}

function normalizePlanName(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// プラン名中の「11,000円」「¥11000」などから最大金額を取得
function extractPlanPrice(planName: string) {
  const amounts = [
    ...planName.matchAll(/([\d,，]{4,})\s*円/g),
    ...planName.matchAll(/[¥￥]\s*([\d,，]{4,})/g),
  ]
    .map((m) => Number(m[1].replace(/[,，]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);

  return amounts.length > 0 ? Math.max(...amounts) : null;
}

function inferCourse(planNameRaw: string | null | undefined) {
  const planName = normalizePlanName(planNameRaw);

  if (planName.includes("Cコース")) return { courseName: "Cコース", coursePrice: 11000 };
  if (planName.includes("Bコース")) return { courseName: "Bコース", coursePrice: 8800 };
  if (planName.includes("Aコース")) return { courseName: "Aコース", coursePrice: 6600 };

  const price = extractPlanPrice(planName);

  // 一休は高単価プランが中心のため、11000円以上はCコース相当として扱う
  if (price !== null && price >= 11000) return { courseName: "Cコース", coursePrice: 11000 };
  if (price !== null && price >= 8800) return { courseName: "Bコース", coursePrice: 8800 };
  if (price !== null && price >= 6600) return { courseName: "Aコース", coursePrice: 6600 };

  return {
    courseName: planName || "席のみ",
    coursePrice: null,
  };
}

function inferCounterOk(parsed: { seatLabel?: string | null; comment?: string | null }) {
  const text = `${parsed.seatLabel ?? ""}\n${parsed.comment ?? ""}`;
  return text.includes("カウンター");
}

export async function importIkyuReservationFromText(args: {
  rawText: string;
  subject?: string | null;
  messageId?: string | null;
}) {
  const parsed = parseIkyuReservationMail(args.rawText, args.subject ?? "");

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
    .eq("external_source", "ikyu")
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
          "一休予約",
          "キャンセル通知を受信",
          parsed.planName ? `プラン: ${parsed.planName}` : null,
          parsed.comment ? `コメント:\n${parsed.comment}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      })
      .eq("id", existingRes.data.id)
      .select("id, status")
      .single();

    if (updateRes.error) throw updateRes.error;

    await sendLineReservationNotice({
      name: parsed.name,
      phone: parsed.phone || null,
      email: null,
      persons: parsed.persons,
      start_at: buildStartAt(parsed.date, parsed.time).toISOString(),
      seatName: null,
      courseName: parsed.planName,
      notes: parsed.comment || null,
      source: "キャンセル",
    });

    return {
      ok: true as const,
      skipped: false,
      action: "cancelled",
      reservation: updateRes.data,
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

  const duration = parsed.durationMinutes || 120;
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

  const assignmentStatus = selectedSeat ? "assigned" : "unassigned";

  const warningMessage = selectedSeat
    ? null
    : counterOk
      ? "一休からの予約ですが、割り当て可能な席がありません。手動で席を確認してください。"
      : "一休からの予約ですが、テーブル席が満席です。カウンター変更可能か確認が必要です。";

  const noteLines = [
    "一休予約",
    parsed.kana ? `ふりがな: ${parsed.kana}` : null,
    parsed.personsDetail ? `人数: ${parsed.personsDetail}` : null,
    parsed.seatLabel ? `席情報: ${parsed.seatLabel.replace(/\n/g, " ")}` : null,
    parsed.planName ? `メールプラン名: ${parsed.planName}` : null,
    parsed.paymentMethod ? `決済方法: ${parsed.paymentMethod}` : null,
    parsed.comment ? `コメント:\n${parsed.comment}` : null,
  ].filter(Boolean);

  const payload = {
    store_id: store.id,
    seat_id: selectedSeat?.id ?? null,

    course_id: null,
    name: parsed.name || "一休予約",
    phone: parsed.phone || null,
    email: null,
    persons,
    start_at: startAt.toISOString(),
    duration_minutes: duration,
    course_name_snapshot: course.courseName,
    course_price_snapshot: course.coursePrice,
    counter_acceptable: counterOk,
    notes: noteLines.join("\n"),
    assignment_status: assignmentStatus,
    warning_message: warningMessage,

    status: "booked",
    source: "ikyu",
    cancel_token: null,
    external_source: "ikyu",
    external_reservation_id: parsed.externalId,
    source_mail_message_id: args.messageId ?? null,
    imported_from_email: true,
  };

  const lineNotice = {
    name: parsed.name,
    phone: parsed.phone || null,
    email: null,
    persons,
    start_at: startAt.toISOString(),
    seatName: selectedSeat?.name ?? "未割当",
    courseName: course.courseName,
    notes: noteLines.join("\n"),
    source: "一休",
    assignmentStatus,
    warningMessage,
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

    await sendLineReservationNotice(lineNotice);

    return {
      ok: true as const,
      skipped: false,
      action: "updated",
      reservation: updateRes.data,
      parsed,
      assignedSeatName: selectedSeat?.name ?? null,
      assignmentStatus,
      warningMessage,
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

  await sendLineReservationNotice(lineNotice);

  return {
    ok: true as const,
    skipped: false,
    action: "created",
    reservation: insertRes.data,
    parsed,
    assignedSeatName: selectedSeat?.name ?? null,
    assignmentStatus,
    warningMessage,
  };
}
