import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { sendLineReservationNotice, sendLineReviewNotice } from "@/steaklamp/lib/lineNotify";
import { chooseSeat, noSeatMessage } from "./seat-allocation";
import type { ReservationRow, SeatMemberRow, SeatRow } from "./seat-allocation";
import {
  applyPointNote,
  buildPointNoteLine,
  detectSeatKind,
  parseHotpepperReservationMail,
} from "./hotpepper-parser";

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function buildStartAt(date: string, time: string) {
  return new Date(`${date}T${time}:00+09:00`);
}

function normalizePlanName(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/→.*$/, "")
    .replace(/【.*?】/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCourse(planNameRaw: string | null | undefined) {
  const planName = normalizePlanName(planNameRaw);

  if (planName.includes("Cコース") || planName.includes("11000") || planName.includes("11,000")) {
    return {
      courseName: "Cコース",
      coursePrice: 11000,
    };
  }

  if (planName.includes("Bコース") || planName.includes("8800") || planName.includes("8,800")) {
    return {
      courseName: "Bコース",
      coursePrice: 8800,
    };
  }

  if (planName.includes("Aコース") || planName.includes("6600") || planName.includes("6,600")) {
    return {
      courseName: "Aコース",
      coursePrice: 6600,
    };
  }

  return {
    courseName: planName || "席のみ",
    coursePrice: null,
  };
}

function inferCounterOk(parsed: {
  seatLabel?: string | null;
  requestText?: string | null;
}) {
  // 席情報の席種（全角表記・2行目の「カウンター」も考慮）、またはご要望にカウンターの記載がある場合
  return (
    detectSeatKind(parsed.seatLabel) === "counter" ||
    String(parsed.requestText ?? "").includes("カウンター")
  );
}

// 席候補を探す。DBから席・予約を読み込み、割り当て自体は seat-allocation の chooseSeat で行う。
export async function findSeat(args: {
  storeId: string;
  persons: number;
  startAt: Date;
  duration: number;
  counterOk: boolean;
  seatKind?: "counter" | "table" | "unknown";
  excludeReservationId?: string | null;
  preferSeatId?: string | null;
}) {
  const { storeId, startAt, duration } = args;
  const endAt = addMinutes(startAt, duration);

  const [seatsRes, membersRes, reservationsRes] = await Promise.all([
    supabaseAdmin
      .from("seats")
      .select("*")
      .eq("store_id", storeId),

    supabaseAdmin
      .from("seat_members")
      .select("group_seat_id, member_seat_id"),

    supabaseAdmin
      .from("reservations")
      .select("*")
      .eq("store_id", storeId)
      .gte("start_at", addMinutes(startAt, -240).toISOString())
      .lte("start_at", addMinutes(endAt, 240).toISOString()),
  ]);

  if (seatsRes.error) throw seatsRes.error;
  if (membersRes.error) throw membersRes.error;
  if (reservationsRes.error) throw reservationsRes.error;

  return chooseSeat({
    seats: (seatsRes.data ?? []) as SeatRow[],
    members: (membersRes.data ?? []) as SeatMemberRow[],
    reservations: (reservationsRes.data ?? []) as ReservationRow[],
    persons: args.persons,
    startAt,
    duration,
    counterOk: args.counterOk,
    seatKind: args.seatKind,
    excludeReservationId: args.excludeReservationId,
    preferSeatId: args.preferSeatId,
  });
}

// 後方互換: 席だけを返す
export async function findSeatCandidate(args: Parameters<typeof findSeat>[0]) {
  return (await findSeat(args)).seat;
}

export async function importHotpepperReservationFromText(args: {
  rawText: string;
  subject?: string | null;
  messageId?: string | null;
}) {
  const subject = args.subject ?? "";
  const parsed = parseHotpepperReservationMail(args.rawText, subject);

  // 自動処理できないメールは台帳を変更せず、ログとLINEで要確認として知らせる
  const needsReview = async (reason: string) => {
    console.warn(
      "STEAKLAMP_HOTPEPPER_NEEDS_REVIEW =",
      JSON.stringify({ reason, externalId: parsed.externalId, mailType: parsed.mailType, subject })
    );
    await sendLineReviewNotice({
      source: "ホットペッパー",
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

  // 予約の新規・変更・キャンセル以外の通知（明日の予約のお知らせ等）は台帳に触れない
  if (parsed.mailType === "ignore") {
    console.log("STEAKLAMP_HOTPEPPER_IGNORED_SUBJECT =", subject);
    return {
      ok: true as const,
      skipped: true,
      reason: "not_reservation_mail",
      parsed,
    };
  }

  if (parsed.mailType === "unknown") {
    return needsReview("種別(新規/変更/キャンセル)を判定できないメール");
  }

  if (!parsed.externalId) {
    return needsReview("予約依頼番号を取得できない");
  }

  // 変更・キャンセルは予約番号だけで処理できる。新規・変更は日時が必須。
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
    .eq("external_source", "hotpepper")
    .eq("external_reservation_id", parsed.externalId)
    .maybeSingle();

  if (existingRes.error) throw existingRes.error;

  if (parsed.mailType === "cancel") {
    if (!existingRes.data) {
      return needsReview("キャンセル対象の予約が台帳に見つからない");
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
        notes: [existingRes.data.notes, "ホットペッパー: キャンセル通知を受信"]
          .filter(Boolean)
          .join("\n"),
      })
      .eq("id", existingRes.data.id)
      .select("id, status")
      .single();

    if (updateRes.error) throw updateRes.error;

    await sendLineReservationNotice({
      name: existingRes.data.name ?? parsed.name,
      phone: null,
      email: null,
      persons: existingRes.data.persons ?? parsed.persons,
      start_at: existingRes.data.start_at,
      seatName: null,
      courseName: parsed.planName,
      notes: null,
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
      return needsReview("キャンセル済みの予約に変更メールが届いた");
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

  const duration = 120;
  const counterOk = inferCounterOk(parsed);
  const course = inferCourse(parsed.planName);

  const seatChoice = await findSeat({
    storeId: store.id,
    persons,
    startAt,
    duration,
    counterOk,
    seatKind: parsed.seatKind,
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
          seatKind: parsed.seatKind,
          sourceLabel: "ホットペッパー",
        });

  
const noteLines = [
    "ホットペッパー予約",
        parsed.seatLabel ? `席情報: ${parsed.seatLabel.replace(/\n/g, " ")}` : null,
    parsed.planName ? `メールコース名: ${parsed.planName}` : null,
    parsed.questionAnswerText ? `苦手なもの・アレルギー:${parsed.questionAnswerText}` : null,
  parsed.requestText ? `ご要望事項:\n${parsed.requestText}` : null,
    buildPointNoteLine(parsed.pointsUsed),

  ].filter(Boolean);

  // 変更メールには要望・アレルギー等が載らないため、既存の備考を消さずに追記する
  const isChange = parsed.mailType === "change";
  const notesText = isChange
    ? [
        applyPointNote(existingRes.data?.notes, parsed.pointsUsed),
        `ホットペッパー: 変更通知を受信（来店日時: ${parsed.prevDateTime || "-"} → ${parsed.date} ${parsed.time} / 人数: ${parsed.persons}名）`,
      ]
        .filter(Boolean)
        .join("\n")
    : noteLines.join("\n");

  const payload = {
    store_id: store.id,
    seat_id: selectedSeat?.id ?? null,

    course_id: null,
    name: parsed.name || "ホットペッパー予約",
    phone: null,
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
    source: "hotpepper",
    cancel_token: null,
    external_source: "hotpepper",
    external_reservation_id: parsed.externalId,
    source_mail_message_id: args.messageId ?? null,
    imported_from_email: true,
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
await sendLineReservationNotice({
  name: parsed.name,
  phone: null,
  email: null,
  persons,
  start_at: startAt.toISOString(),
  seatName: selectedSeat?.name ?? "未割当",
  courseName: course.courseName,
  notes: notesText,
  source: "ホットペッパー",
  isChange,
  assignmentStatus,
  warningMessage,
});

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
await sendLineReservationNotice({
  name: parsed.name,
  phone: null,
  email: null,
  persons,
  start_at: startAt.toISOString(),
  seatName: selectedSeat?.name ?? "未割当",
  courseName: course.courseName,
  notes: noteLines.join("\n"),
  source: "ホットペッパー",
  assignmentStatus,
  warningMessage,
});

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
