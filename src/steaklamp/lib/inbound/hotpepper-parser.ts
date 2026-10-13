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
    persons: personsMatch ? Number(personsMatch[1]) : 0,
    planName: get("コース"),
    seatLabel: get("席情報"),
    requestText,
    rawText: normalized,
questionAnswerText,

  };
}


