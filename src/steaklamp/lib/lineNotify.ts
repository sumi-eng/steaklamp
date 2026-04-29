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

  const text = [
    "【Lamp】新しい予約が入りました",
    "",
    `日時：${formatJpDateTime(reservation.start_at)}`,
    `名前：${reservation.name ?? "未設定"} 様`,
    `人数：${reservation.persons ?? "-"}名`,
    `席：${reservation.seatName ?? "-"}`,
    `コース：${reservation.courseName ?? "席のみ"}`,
    `電話：${reservation.phone ?? "-"}`,
    reservation.email ? `メール：${reservation.email}` : null,
    reservation.notes ? `備考：${reservation.notes}` : null,
    reservation.source ? `経路：${reservation.source}` : null,
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
