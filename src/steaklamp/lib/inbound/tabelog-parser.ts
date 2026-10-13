export type TabelogMailType = "new" | "change" | "cancel" | "ignore" | "unknown";

function clean(value: string) {
  return String(value ?? "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// 基準日時(メール受信日時)のJSTでの年
function jstYear(base: Date) {
  const jst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCFullYear();
}

// 年が補われた日付が基準日より、これ以上過去なら翌年の予約とみなす
const YEAR_ROLLOVER_DAYS = 60;

// 「変更前 → 変更後」形式の値は変更後だけを返す（矢印が無ければそのまま）
function afterArrow(value: string) {
  const parts = value.split(/[→➡⇒]/);
  return (parts[parts.length - 1] ?? "").trim();
}

function beforeArrow(value: string) {
  return /[→➡⇒]/.test(value) ? value.split(/[→➡⇒]/)[0].trim() : "";
}

// 本文の項目ラベル。複数行の値（ご要望など）の終端判定に使う。
const FIELD_LABELS = [
  "お名前",
  "電話番号",
  "日付",
  "来店時刻",
  "滞在可能時間",
  "人数",
  "コース",
  "利用Vポイント",
  "卓",
  "ご要望",
  "変更時のメッセージ",
  "キャンセル理由",
  "キャンセルポリシー",
];

const LABEL_LINE = new RegExp(`^(?:${FIELD_LABELS.join("|")})[ 　\\t]*[:：]`);
const SECTION_END = /^(?:-{5,}|={5,}|https?:\/\/)/;

// 「ラベル ： 値」の値を取得する。値が次の行以降に続く場合は、
// 次の項目ラベル・区切り線・URLの手前まで連結する。
function getField(text: string, label: string) {
  const lines = text.split("\n");
  const head = new RegExp(`^${label}[ 　\\t]*[:：](.*)$`);

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(head);
    if (!m) continue;

    const values = [m[1]];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (LABEL_LINE.test(line) || SECTION_END.test(line)) break;
      values.push(lines[j]);
    }

    return values
      .map((v) => v.replace(/ /g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return "";
}

// 管理画面URL（…/time-schedule/2026-02-21?bookingId=net:48912424）
function parseBookingUrl(text: string) {
  const m = text.match(/time-schedule\/(\d{4})-(\d{2})-(\d{2})[^\s]*?[?&]bookingId=([^&\s]+)/);
  if (m) {
    return { date: `${m[1]}-${m[2]}-${m[3]}`, bookingId: safeDecode(m[4]) };
  }

  const id = text.match(/bookingId=([^&\s]+)/);
  return { date: "", bookingId: id ? safeDecode(id[1]) : "" };
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

// 年の無い「月/日」に年を補う。12月に届いた1月の予約が去年の日付にならないよう、
// 補った日付が基準日(メール受信日時)より2か月以上過去なら翌年として扱う。
export function buildDateFromMonthDay(monthDay: string, base: Date = new Date()) {
  const m = monthDay.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return "";

  const month = m[1].padStart(2, "0");
  const day = m[2].padStart(2, "0");

  let year = jstYear(base);
  const candidate = new Date(`${year}-${month}-${day}T00:00:00+09:00`);
  const daysPast = (base.getTime() - candidate.getTime()) / (24 * 60 * 60 * 1000);
  if (daysPast >= YEAR_ROLLOVER_DAYS) year += 1;

  return `${year}-${month}-${day}`;
}

// ※食べログの送信元ごとの通知（注意喚起・請求・来店一覧など）は予約ではない。
//   「【食べログ】…月末付近の予約変更・キャンセル…」のように件名に変更/キャンセルを含むため、
//   予約の件名より先に除外する。
const IGNORED_SUBJECTS = [
  /^\s*【注意喚起】/,
  /^\s*【食べログ】/,
  /【本日のご来店一覧】/,
];

function detectTypeFromSubject(subject: string): TabelogMailType | null {
  if (IGNORED_SUBJECTS.some((re) => re.test(subject))) return "ignore";

  const s = subject.trim();
  if (/^【新規予約】/.test(s)) return "new";
  if (/^【予約キャンセル】/.test(s)) return "cancel";
  if (/^【予約変更】/.test(s)) return "change"; // 変更の件名は未確認（暫定）
  return null;
}

// 本文の冒頭の一文での判定。「キャンセルポリシー」「キャンセルされる場合があります」等の
// 他の箇所の語や、キャンセル理由欄の「変更」には反応しないよう、項目欄（お名前〜）より前だけを見る。
function detectTypeFromBody(text: string): TabelogMailType {
  const idx = text.search(/^お名前[ 　\t]*[:：]/m);
  const intro = idx >= 0 ? text.slice(0, idx) : text.slice(0, 600);

  if (intro.includes("お客様により下記予約内容がキャンセルされました")) return "cancel";
  if (intro.includes("お客様により下記予約内容が変更されました")) return "change";
  if (intro.includes("新しい予約が入りました")) return "new";
  return "unknown";
}

// 件名を優先して判定する。件名が一覧に無ければ本文の冒頭文で判定し、
// どちらも判定できない・食い違う場合は unknown（要確認）。
function detectType(subject: string, text: string): TabelogMailType {
  const bySubject = detectTypeFromSubject(subject);
  if (bySubject === "ignore") return "ignore";

  const byBody = detectTypeFromBody(text);

  if (bySubject) {
    if (byBody !== "unknown" && byBody !== bySubject) return "unknown";
    return bySubject;
  }

  return byBody;
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

function normalizeName(value: string) {
  return clean(value)
    .replace(/様$/, "")
    .trim();
}

export function parseTabelogReservationMail(
  text: string,
  subject = "",
  receivedAt: Date = new Date()
) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");

  const url = parseBookingUrl(normalized);

  const dateRaw = getField(normalized, "日付");
  const timeRaw = getField(normalized, "来店時刻");
  const personsRaw = getField(normalized, "人数");
  const durationRaw = getField(normalized, "滞在可能時間");

  // 年はURLの日付（変更メールでは変更後の日付）を優先し、無ければ月日から補う
  const date = url.date || buildDateFromMonthDay(afterArrow(dateRaw), receivedAt);

  return {
    mailType: detectType(subject, normalized),
    externalId: url.bookingId,
    reservationRoute: "食べログ",
    name: normalizeName(getField(normalized, "お名前")) || "食べログ予約",
    phone: clean(getField(normalized, "電話番号")),
    date,
    prevDate: beforeArrow(dateRaw),
    time: clean(afterArrow(timeRaw)),
    persons: parsePersons(afterArrow(personsRaw)),
    durationMinutes: parseDurationMinutes(afterArrow(durationRaw)),
    planName: clean(getField(normalized, "コース")) || "お席のみのご予約",
    seatLabel: clean(getField(normalized, "卓")),
    requestText: getField(normalized, "ご要望"),
    changeMessage: getField(normalized, "変更時のメッセージ"),
    cancelReason: getField(normalized, "キャンセル理由"),
    rawText: normalized,
  };
}
