import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { sendLineReservationNotice, sendLineReviewNotice } from "@/steaklamp/lib/lineNotify";
import { findSeat } from "./hotpepper-import";
import { detectSeatKind } from "./hotpepper-parser";
import { noSeatMessage } from "./seat-allocation";
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

export async function importIkyuReservationFromText(args: {
  rawText: string;
  subject?: string | null;
  messageId?: string | null;
}) {
  const subject = args.subject ?? "";
  const parsed = parseIkyuReservationMail(args.rawText, subject);

  // 自動処理できないメールは台帳を変更せず、ログとLINEで要確認として知らせる
  const needsReview = async (reason: string) => {
    console.warn(
      "STEAKLAMP_IKYU_NEEDS_REVIEW =",
      JSON.stringify({ reason, externalId: parsed.externalId, mailType: parsed.mailType, subject })
    );
    await sendLineReviewNotice({
      source: "一休",
      reason,
      externalId: parsed.externalId || null,
      subject,
    });
    return {
      ok: true as const,
      skipped: true,
      needsReview: true,
      reason,
      parsed,
    };
  };

  // 予約以外の通知（レストラン情報変更通知・ご精算のご案内等）は台帳に触れない
  if (parsed.mailType === "ignore") {
    console.log("STEAKLAMP_IKYU_IGNORED_SUBJECT =", subject);
    return {
      ok: true as const,
      skipped: true,
      reason: "not_reservation_mail",
      parsed,
    };
  }

  if (parsed.mailType === "unknown") {
    return needsReview("種別(新規/変更/取消)を判定できないメール");
  }

  if (!parsed.externalId) {
    return needsReview("予約番号を取得できない");
  }

  // 取消は予約番号だけで処理できる。新規・変更は日時が必須。
  if (parsed.mailType !== "cancel" && (!parsed.date || !parsed.time)) {
    if (parsed.mailType === "change") {
      return needsReview("変更メールから来店日時を読み取れない");
    }
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
    .select("id, status, session_id, name, persons, start_at, notes, seat_id")
    .eq("store_id", store.id)
    .eq("external_source", "ikyu")
    .eq("external_reservation_id", parsed.externalId)
    .maybeSingle();

  if (existingRes.error) throw existingRes.error;

  if (parsed.mailType === "cancel") {
    if (!existingRes.data) {
      return needsReview("取消対象の予約が台帳に見つからない");
    }

    if (existingRes.data.status === "cancelled") {
      return {
        ok: true as const,
        skipped: true,
        reason: "already_cancelled",
        parsed,
      };
    }

    const updateRes = await supabaseAdmin
      .from("reservations")
      .update({
        status: "cancelled",
        notes: [
          existingRes.data.notes,
          "一休: 取消通知を受信",
          parsed.cancelReason ? `キャンセル理由: ${parsed.cancelReason}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      })
      .eq("id", existingRes.data.id)
      .select("id, status")
      .single();

    if (updateRes.error) throw updateRes.error;

    await sendLineReservationNotice({
      name: existingRes.data.name ?? parsed.name,
      phone: parsed.phone || null,
      email: null,
      persons: existingRes.data.persons ?? parsed.persons,
      start_at: existingRes.data.start_at,
      seatName: null,
      courseName: parsed.planName,
      notes: parsed.cancelReason ? `キャンセル理由: ${parsed.cancelReason}` : null,
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

  if (parsed.mailType === "change") {
    if (!existingRes.data) {
      return needsReview("変更対象の予約が台帳に見つからない（新規作成は行いません）");
    }
    if (existingRes.data.status === "cancelled") {
      return needsReview("取消済みの予約に変更メールが届いた");
    }
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
  // 席管理名称の「カウンター」「テーブル」から席種を決める（コメント欄は使わない）
  const seatKind = detectSeatKind(parsed.seatLabel);
  const counterOk = seatKind === "counter";
  const course = inferCourse(parsed.planName);

  const seatChoice = await findSeat({
    storeId: store.id,
    persons,
    startAt,
    duration,
    counterOk,
    seatKind,
    excludeReservationId: existingRes.data?.id ?? null,
    // 変更メールでは、元の席が新しい日時・人数でも空いていればそのまま維持する
    preferSeatId: parsed.mailType === "change" ? existingRes.data?.seat_id ?? null : null,
  });
  const selectedSeat = seatChoice.seat;

  const assignmentStatus = selectedSeat ? "assigned" : "unassigned";

  const warningMessage =
    selectedSeat || !seatChoice.reason
      ? null
      : noSeatMessage({
          reason: seatChoice.reason,
          persons,
          counterOk,
          seatKind,
          sourceLabel: "一休",
        });

  
const noteLines = [
    "一休予約",
    parsed.kana ? `ふりがな: ${parsed.kana}` : null,
    parsed.personsDetail ? `人数: ${parsed.personsDetail}` : null,
    parsed.seatLabel ? `席情報: ${parsed.seatLabel.replace(/\n/g, " ")}` : null,
    parsed.planName ? `メールプラン名: ${parsed.planName}` : null,
    parsed.paymentMethod ? `決済方法: ${parsed.paymentMethod}` : null,
    parsed.comment ? `コメント:\n${parsed.comment}` : null,
  ].filter(Boolean);

  // 変更は既存の備考を消さずに追記する（新規メールの備考内容を失わないため）
  const isChange = parsed.mailType === "change";
  const notesText = isChange
    ? [
        existingRes.data?.notes,
        `一休: 変更通知を受信（来店日時: ${parsed.date} ${parsed.time} / 人数: ${persons}名）`,
        parsed.comment ? `コメント:\n${parsed.comment}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : noteLines.join("\n");

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
    notes: notesText,
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
    notes: notesText,
    source: "一休",
    isChange,
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
