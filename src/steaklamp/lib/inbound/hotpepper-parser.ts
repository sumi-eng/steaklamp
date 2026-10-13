export type HotpepperMailType = "new" | "change" | "cancel" | "ignore" | "unknown";

function normalizeMultilineValue(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLine(value: string) {
  return value.replace(/^[ 　\t]+/, "").replace(/[ 　\t]+$/, "");
}

function extractQuestionAnswerText(text: string) {
  // 「■質問の回答」「■質問と回答」のどちらの見出しにも対応
  const m = text.match(
    /■質問(?:の|と)回答[ \t]*\n([\s\S]*?)(?=\n【|\n■|\n□■|\n-{5,}|\n[ \t]*\n|$)/
  );

  const block = normalizeMultilineValue(m?.[1] ?? "");
  if (!block) return "";

  // 回答が空（"A." のみ）のとき、次の行の注意書きを拾わないよう同じ行だけを見る
  const answer = block.match(/^A[\.．：:][ \t　]*(.*)$/m);
  if (!answer) return "";

  return answer[1].trim();
}

// 「変更前 → 変更後」形式の値は変更後だけを返す（矢印が無ければそのまま）
function afterArrow(value: string) {
  const parts = value.split(/[→➡⇒]/);
  return (parts[parts.length - 1] ?? "").trim();
}

function beforeArrow(value: string) {
  return /[→➡⇒]/.test(value) ? value.split(/[→➡⇒]/)[0].trim() : "";
}

const BOOKING_KIND = "(?:リクエスト予約|即予約)";

// 台帳に関係しない通知メール（件名で判定）
const IGNORED_SUBJECTS = [
  /明日の予約のお知らせ/,
  /昨日来店予定の予約確認/,
  /^\s*【ご確認ください】/,
];

// 件名での判定（例: [即予約]予約が確定しました / 予約内容が変更されました / 予約がキャンセルされました）
function detectTypeFromSubject(subject: string): HotpepperMailType | null {
  if (IGNORED_SUBJECTS.some((re) => re.test(subject))) return "ignore";
  if (subject.includes("予約がキャンセルされました")) return "cancel";
  if (subject.includes("予約内容が変更されました")) return "change";
  if (subject.includes("予約が確定しました")) return "new";
  return null;
}

// 本文の見出しでの判定（件名が知らない書式のときの補助）
function detectTypeFromBody(text: string): HotpepperMailType {
  if (new RegExp(`【${BOOKING_KIND}】の?キャンセル`).test(text)) return "cancel";
  if (new RegExp(`【${BOOKING_KIND}】の?変更`).test(text)) return "change";
  if (new RegExp(`【${BOOKING_KIND}】の?(?:申し込み|申込)`).test(text)) return "new";
  return "unknown";
}

// 件名を優先して 新規/変更/キャンセル/対象外(ignore) を判定する。
// 件名が一覧に無い場合は本文の見出しで判定し、どちらも判定できなければ unknown（要確認）。
// 件名と本文の判定が食い違う場合も unknown にして台帳を変更しない。
export function detectHotpepperMailType(
  text: string,
  subject = ""
): HotpepperMailType {
  const bySubject = detectTypeFromSubject(subject);
  if (bySubject === "ignore") return "ignore";

  const byBody = detectTypeFromBody(text);

  if (bySubject) {
    if (byBody !== "unknown" && byBody !== bySubject) return "unknown";
    return bySubject;
  }

  return byBody;
}

export type SeatKind = "counter" | "table" | "unknown";

// 席情報の席種を判定する。全角英数字・記号（Ｔ１～Ｔ３、Ｃ１～８ 等）は半角にそろえてから見る。
// 「C1～8」はカウンター席、「T1～T3」はテーブル席。2行目の「カウンター（喫煙可）」等の表記も使う。
export function detectSeatKind(seatLabel: string | null | undefined): SeatKind {
  const label = String(seatLabel ?? "").normalize("NFKC");
  if (!label) return "unknown";

  if (label.includes("カウンター") || /(^|\s)C\s*\d+\s*[~\-ー]\s*C?\s*\d+/.test(label)) {
    return "counter";
  }
  if (label.includes("テーブル") || /(^|\s)T\s*\d+/.test(label)) return "table";
  return "unknown";
}

// 「■席情報：」の値。次の行以降のインデントされた行（2行目の席種表記など）も含める。
function getSeatInfo(normalizedText: string) {
  const lines = normalizedText.split("\n");
  const i = lines.findIndex((line) => line.startsWith("■席情報："));
  if (i < 0) return "";

  const values = [lines[i].slice("■席情報：".length).trim()];
  for (let j = i + 1; j < lines.length; j++) {
    if (!/^[ 　\t]+\S/.test(lines[j])) break;
    values.push(lines[j].trim());
  }

  return values.filter(Boolean).join("\n");
}

const POINT_NOTE_PREFIX = "ポイント利用：";

// 備考に入れるポイント利用の行。0ポイント・不明のときは入れない。
export function buildPointNoteLine(pointsUsed: number | null | undefined) {
  return pointsUsed && pointsUsed > 0
    ? `${POINT_NOTE_PREFIX}${pointsUsed.toLocaleString("ja-JP")}ポイント`
    : null;
}

// 変更メール用: 既存備考の「ポイント利用：」行を最新の値に差し替える（要望・アレルギー等は残す）。
// メールにポイント利用額が無い(null)ときは既存備考をそのまま返す。
export function applyPointNote(existingNotes: string | null | undefined, pointsUsed: number | null) {
  const existing = String(existingNotes ?? "");
  if (pointsUsed === null) return existing;

  const kept = existing
    .split("\n")
    .filter((line) => !line.startsWith(POINT_NOTE_PREFIX));
  const pointLine = buildPointNoteLine(pointsUsed);

  return [...kept, pointLine].filter(Boolean).join("\n");
}

export function parseHotpepperReservationMail(text: string, subject = "") {
  const normalized = text.replace(/\r\n/g, "\n");

  const get = (label: string) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = normalized.match(new RegExp(`■${escaped}：(.+)`));
    return m?.[1]?.trim() || "";
  };

  const getBlock = (label: string) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const re = new RegExp(
      `■${escaped}[：: ]*\\n([\\s\\S]*?)(?=\\n\\s*\\n|\\n【|\\n■|\\n□■|\\n[-]{5,}|$)`,
      "m"
    );

    const m = normalized.match(re);
    if (!m?.[1]) return "";

    return normalizeMultilineValue(
      m[1]
        .split("\n")
        .map((line) => cleanLine(line))
        .join("\n")
    );
  };

  const dateTimeRaw = get("来店日時");
  const dateTime = afterArrow(dateTimeRaw);
  const prevDateTime = beforeArrow(dateTimeRaw);
  const dateMatch = dateTime.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const timeMatch = dateTime.match(/(\d{1,2}):(\d{2})/);

  const date = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
    : "";

  const time = timeMatch
    ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`
    : "";

  const personsRaw = get("人数");
  const personsText = afterArrow(personsRaw);

  // 「■ポイント利用額：500ポイント」（変更時は「500ポイント → 1000ポイント」）。変更後の値を使う。
  const seatLabel = getSeatInfo(normalized);

  const pointsRaw = afterArrow(get("ポイント利用額"));
  const pointsDigits = pointsRaw.match(/[\d,]+/)?.[0]?.replace(/,/g, "") ?? "";
  const pointsUsed = pointsDigits ? Number(pointsDigits) : null;
  const personsMatch = personsText.match(/(\d+)/);

  const requestText =
    getBlock("ご要望事項") ||
    getBlock("お店へのご要望") ||
    getBlock("ご要望") ||
    "";

const questionAnswerText = extractQuestionAnswerText(normalized);


  return {
    mailType: detectHotpepperMailType(normalized, subject),
    externalId: get("予約依頼番号"),
    reservationRoute: get("予約経路"),
    name: get("代表者").replace(/様$/, "").trim(),
    date,
    time,
    prevDateTime,
    prevPersonsText: beforeArrow(personsRaw),
    pointsUsed,
    persons: personsMatch ? Number(personsMatch[1]) : 0,
    planName: get("コース"),
    seatLabel,
    seatKind: detectSeatKind(seatLabel),
    requestText,
    rawText: normalized,
questionAnswerText,

  };
}


