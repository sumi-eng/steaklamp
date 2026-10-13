type LineNotifyReservation = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  persons?: number | null;
  start_at?: string | null;
  seatName?: string | null;
  courseName?: string | null;
  notes?: string | null;
  source?: string | null;
  isChange?: boolean;
assignmentStatus?: string | null;
warningMessage?: string | null;

};

function formatJpDateTime(value?: string | null) {
  if (!value) return "未設定";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "未設定";

  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function sendLineReservationNotice(
  reservation: LineNotifyReservation
) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to =
    process.env.LINE_STEAKLAMP_TO_ID ||
    process.env.LINE_TO_GROUP_ID ||
    process.env.LINE_TO_USER_ID;

  if (!token || !to) {
    console.warn("LINE env is missing");
    return;
  }

const isCancel = reservation.source === "キャンセル";
const needsAttention =
  reservation.assignmentStatus && reservation.assignmentStatus !== "assigned";

const text = [
  isCancel
    ? "【Lamp】予約がキャンセルされました"
    : reservation.isChange
      ? needsAttention
        ? "【要確認】SteakLamp 予約が変更されました"
        : "【Lamp】予約が変更されました"
    : needsAttention
      ? "【要確認】SteakLamp 予約が入りました"
      : "【Lamp】新しい予約が入りました",
  "",
  `日時：${formatJpDateTime(reservation.start_at)}`,
  `名前：${reservation.name ?? "未設定"} 様`,
  `人数：${reservation.persons ?? "-"}名`,
  `席：${reservation.seatName ?? "-"}`,
  needsAttention ? "⚠ 席未割当・要対応" : null,
  reservation.warningMessage ? `理由：${reservation.warningMessage}` : null,
  `コース：${reservation.courseName ?? "席のみ"}`,
  `電話：${reservation.phone ?? "-"}`,
  reservation.email ? `メール：${reservation.email}` : null,
  reservation.notes ? `備考：${reservation.notes}` : null,
  reservation.source && !isCancel ? `経路：${reservation.source}` : null,
]
  .filter(Boolean)
  .join("\n");


  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      messages: [
        {
          type: "text",
          text,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("LINE notify failed", res.status, detail);
  }
}

// 取り込みメールを自動処理できなかった場合の「要確認」通知
export async function sendLineReviewNotice(args: {
  source: string;
  reason: string;
  externalId?: string | null;
  subject?: string | null;
  detail?: string | null;
}) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to =
    process.env.LINE_STEAKLAMP_TO_ID ||
    process.env.LINE_TO_GROUP_ID ||
    process.env.LINE_TO_USER_ID;

  if (!token || !to) {
    console.warn("LINE env is missing");
    return;
  }

  const text = [
    "【要確認】予約メールを自動反映できませんでした",
    "",
    `経路：${args.source}`,
    `理由：${args.reason}`,
    args.externalId ? `予約番号：${args.externalId}` : null,
    args.subject ? `件名：${args.subject}` : null,
    args.detail ? args.detail : null,
    "",
    "予約台帳は変更していません。メールを確認して手動で対応してください。",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("LINE review notify failed", res.status, detail);
  }
}
