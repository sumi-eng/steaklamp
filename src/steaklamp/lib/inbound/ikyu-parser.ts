export type IkyuMailType = "new" | "change" | "cancel" | "ignore" | "unknown";

function normalizeMultilineValue(value: string) {
  return value
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLine(value: string) {
  return value.replace(/^[ 　\t]+/, "").replace(/[ 　\t]+$/, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ●ラベル　　：値 の値部分（続く行は、空行・次の●・区切り線まで連結する）
function getField(text: string, label: string) {
  const re = new RegExp(`^●${escapeRegExp(label)}[ 　\\t]*[：:](.*)$`, "m");
  const m = re.exec(text);
  if (!m) return "";

  const lines = [m[1]];
  const rest = text.slice(m.index + m[0].length).split("\n").slice(1);

  for (const line of rest) {
    const trimmed = cleanLine(line);
    if (!trimmed) break;
    if (trimmed.startsWith("●")) break;
    if (/^[-=━─＝－◆■□]{3,}/.test(trimmed)) break;
    lines.push(line);
  }

  return normalizeMultilineValue(lines.map((line) => cleanLine(line)).join("\n"));
}

// 予約ではない通知（件名で判定）。「レストラン情報変更通知」は「変更」を含むが予約変更ではない。
const IGNORED_SUBJECTS = [
  /レストラン情報変更通知/,
  /ご精算のご案内/,
  /送信テスト/,
  /お打ち合わせのお礼/,
];

// 件名での判定（例: 【新規_現地決済】… / 【取消】… / 【変更】…）。
// 新規は決済方法で件名が変わるため「【新規_」「【新規】」の先頭一致で扱う。
function detectTypeFromSubject(subject: string): IkyuMailType | null {
  if (IGNORED_SUBJECTS.some((re) => re.test(subject))) return "ignore";

  const s = subject.trim();
  if (/^【(?:取消|キャンセル)/.test(s)) return "cancel";
  if (/^【変更/.test(s)) return "change";
  if (/^【新規/.test(s)) return "new";
  return null;
}

// 本文の見出し行（◆【新規】予約受付のお知らせ◆ など）での判定。
// コメント欄などに「変更」「キャンセル」が入ることがあるため、見出し行だけを見る。
function detectTypeFromBody(text: string): IkyuMailType {
  const m = text.slice(0, 600).match(/^◆[^\n]*?【(新規|取消|キャンセル|変更)[^】]*】/m);
  if (!m) return "unknown";
  if (m[1] === "取消" || m[1] === "キャンセル") return "cancel";
  if (m[1] === "変更") return "change";
  return "new";
}

// 件名を優先して判定する。件名が一覧に無ければ本文の見出し行で判定し、
// どちらも判定できない・食い違う場合は unknown（要確認）。
function detectType(subject: string, text: string): IkyuMailType {
  const bySubject = detectTypeFromSubject(subject);
  if (bySubject === "ignore") return "ignore";

  const byBody = detectTypeFromBody(text);

  if (bySubject) {
    if (byBody !== "unknown" && byBody !== bySubject) return "unknown";
    return bySubject;
  }

  return byBody;
}

function parseDateTime(value: string) {
  const dateMatch = value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const timeMatch = value.match(/(\d{1,2})[:：](\d{2})/);

  const date = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
    : "";

  const time = timeMatch
    ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`
    : "";

  return { date, time };
}

function parseDurationMinutes(value: string) {
  const hour = value.match(/(\d+(?:\.\d+)?)\s*時間/);
  const minute = value.match(/(\d+)\s*分/);

  if (hour) {
    return Math.round(Number(hour[1]) * 60) + (minute ? Number(minute[1]) : 0);
  }
  if (minute) return Number(minute[1]);

  return 120;
}

function parsePersons(value: string) {
  const m = value.match(/(\d+)\s*[人名]/) ?? value.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

// 「増田 佳祥（ますだかさき）」→ 氏名とふりがなに分離
function parseName(value: string) {
  const firstLine = value.split("\n")[0] ?? "";
  const m = firstLine.match(/^(.*?)[（(]([^）)]*)[）)]/);

  const name = (m ? m[1] : firstLine).replace(/様$/, "").trim();
  const kana = m ? m[2].trim() : "";

  return { name, kana };
}

function parseExternalId(text: string, subject = "") {
  const field = getField(text, "予約番号");
  // 本文から読めない場合は件名の「[予約NO：IR…]」を使う
  const m =
    field.match(/IR\d+/) ??
    text.match(/IR\d{6,}/) ??
    subject.match(/予約NO[：:]\s*(IR\d+)/);
  return m?.[1] ?? m?.[0] ?? field;
}

export function parseIkyuReservationMail(text: string, subject = "") {
  const normalized = text.replace(/\r\n/g, "\n");

  const { date, time } = parseDateTime(getField(normalized, "来店日時"));
  const { name, kana } = parseName(getField(normalized, "来店代表者氏名"));
  const personsDetail = getField(normalized, "来店人数") || getField(normalized, "利用人数");

  return {
    mailType: detectType(subject, normalized),
    externalId: parseExternalId(normalized, subject),
    name,
    kana,
    phone: getField(normalized, "来店代表者連絡先").replace(/[^\d+-]/g, ""),
    date,
    time,
    durationMinutes: parseDurationMinutes(getField(normalized, "滞在時間（目安）") || getField(normalized, "滞在時間")),
    // 新規は「来店人数」、取消は「利用人数」
    persons: parsePersons(personsDetail),
    personsDetail,
    paymentMethod: getField(normalized, "決済方法"),
    planNo: getField(normalized, "プランNo"),
    // 新規は「プラン」、取消は「予約プラン」
    planName: getField(normalized, "プラン") || getField(normalized, "予約プラン"),
    seatLabel: getField(normalized, "席管理名称"),
    comment: getField(normalized, "コメント"),
    cancelReason: getField(normalized, "キャンセル理由"),
    rawText: normalized,
  };
}
