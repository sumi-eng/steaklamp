export type TabelogMailType = "new" | "cancel" | "unknown";

function clean(value: string) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function currentJstYear() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.getFullYear();
}

function buildDateFromMonthDay(monthDay: string) {
  const m = monthDay.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return "";

  const year = currentJstYear();
  const month = m[1].padStart(2, "0");
  const day = m[2].padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getLineValue(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*[:：]\\s*(.+)`);
  const m = text.match(re);
  return clean(m?.[1] ?? "");
}

function getBlockValue(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${escaped}\\s*[:：]\\s*\\n([\\s\\S]*?)(?=\\n\\S.+?\\s*[:：]|\\n[-=]{5,}|$)`,
    "m"
  );

  const m = text.match(re);
  return clean(m?.[1] ?? "");
}

function detectType(text: string): TabelogMailType {
  if (text.includes("新しい予約が入りました")) return "new";
  if (text.includes("キャンセル") && text.includes("食べログ")) return "cancel";
  return "unknown";
}

function parseDurationMinutes(value: string) {
  const hour = value.match(/(\d+(?:\.\d+)?)\s*時間/);
  if (hour) return Math.round(Number(hour[1]) * 60);

  const minute = value.match(/(\d+)\s*分/);
  if (minute) return Number(minute[1]);

  return 120;
}

function parsePersons(value: string) {
  const m = value.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function parseExternalId(text: string) {
  const m = text.match(/bookingId=([^&\s]+)/);
  return m?.[1]?.trim() ?? "";
}

function normalizeName(value: string) {
  return clean(value)
    .replace(/様$/, "")
    .trim();
}

function normalizeSeatLabel(value: string) {
  return clean(value);
}

export function parseTabelogReservationMail(text: string) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");

  const dateRaw = getLineValue(normalized, "日付");
  const timeRaw = getLineValue(normalized, "来店時刻");
  const personsRaw = getLineValue(normalized, "人数");
  const durationRaw = getLineValue(normalized, "滞在可能時間");

  const requestText =
    getBlockValue(normalized, "ご要望") ||
    getLineValue(normalized, "ご要望") ||
    "";

  return {
    mailType: detectType(normalized),
    externalId: parseExternalId(normalized),
    reservationRoute: "食べログ",
    name: normalizeName(getLineValue(normalized, "お名前")) || "食べログ予約",
    phone: clean(getLineValue(normalized, "電話番号")),
    date: buildDateFromMonthDay(dateRaw),
    time: clean(timeRaw),
    persons: parsePersons(personsRaw),
    durationMinutes: parseDurationMinutes(durationRaw),
    planName: clean(getLineValue(normalized, "コース")) || "お席のみのご予約",
    seatLabel: normalizeSeatLabel(getLineValue(normalized, "卓")),
    requestText,
    rawText: normalized,
  };
}
