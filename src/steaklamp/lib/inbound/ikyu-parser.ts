export type IkyuMailType = "new" | "change" | "cancel" | "unknown";

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

function detectType(subject: string, text: string): IkyuMailType {
  const head = `${subject}\n${text.slice(0, 500)}`;
  if (subject.includes("キャンセル") || head.includes("【キャンセル】")) return "cancel";
  if (head.includes("【変更】")) return "change";
  if (head.includes("【新規】")) return "new";
  return "unknown";
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

function parseExternalId(text: string) {
  const field = getField(text, "予約番号");
  const m = field.match(/IR\d+/) ?? text.match(/IR\d{6,}/);
  return m?.[0] ?? field;
}

export function parseIkyuReservationMail(text: string, subject = "") {
  const normalized = text.replace(/\r\n/g, "\n");

  const { date, time } = parseDateTime(getField(normalized, "来店日時"));
  const { name, kana } = parseName(getField(normalized, "来店代表者氏名"));

  return {
    mailType: detectType(subject, normalized),
    externalId: parseExternalId(normalized),
    name,
    kana,
    phone: getField(normalized, "来店代表者連絡先").replace(/[^\d+-]/g, ""),
    date,
    time,
    durationMinutes: parseDurationMinutes(getField(normalized, "滞在時間（目安）") || getField(normalized, "滞在時間")),
    persons: parsePersons(getField(normalized, "来店人数")),
    personsDetail: getField(normalized, "来店人数"),
    paymentMethod: getField(normalized, "決済方法"),
    planNo: getField(normalized, "プランNo"),
    planName: getField(normalized, "プラン"),
    seatLabel: getField(normalized, "席管理名称"),
    comment: getField(normalized, "コメント"),
    rawText: normalized,
  };
}
