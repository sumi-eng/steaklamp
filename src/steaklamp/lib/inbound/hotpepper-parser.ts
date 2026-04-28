export type HotpepperMailType = "new" | "cancel" | "unknown";

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
  const m = text.match(
    /■質問の回答\s*\n([\s\S]*?)(?=\n【|\n■|\n□■|\n-{5,}|$)/
  );

  const block = normalizeMultilineValue(m?.[1] ?? "");
  if (!block) return "";

  const answer = block.match(/A[\.．：:]\s*([^\n]+)/);
  if (answer?.[1]) return answer[1].trim();

  return block;
}


export function parseHotpepperReservationMail(text: string) {
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

  const detectType = (): HotpepperMailType => {
    if (normalized.includes("【リクエスト予約】のキャンセル")) return "cancel";
    if (normalized.includes("【リクエスト予約】の申し込み")) return "new";
    return "unknown";
  };

  const dateTime = get("来店日時");
  const dateMatch = dateTime.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const timeMatch = dateTime.match(/(\d{1,2}):(\d{2})/);

  const date = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
    : "";

  const time = timeMatch
    ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`
    : "";

  const personsText = get("人数");
  const personsMatch = personsText.match(/(\d+)/);

  const requestText =
    getBlock("ご要望事項") ||
    getBlock("お店へのご要望") ||
    getBlock("ご要望") ||
    "";

const questionAnswerText = extractQuestionAnswerText(normalized);


  return {
    mailType: detectType(),
    externalId: get("予約依頼番号"),
    reservationRoute: get("予約経路"),
    name: get("代表者").replace(/様$/, "").trim(),
    date,
    time,
    persons: personsMatch ? Number(personsMatch[1]) : 0,
    planName: get("コース"),
    seatLabel: get("席情報"),
    requestText,
    rawText: normalized,
questionAnswerText,

  };
}


