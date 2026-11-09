// 予約台帳のタイムテーブルで、予約の枠を何色で表示するかを決める。
//   red    : 備考あり（お客様の要望・アレルギー・記念日・スタッフのメモなど）
//   yellow : コースあり（「席のみ」以外）で備考なし
//   blue   : 席のみで備考なし
//   gray   : キャンセル済みなど（色分けの対象外）
// コースと備考の両方がある場合は red を優先する。

export type ReservationTone = "red" | "yellow" | "blue" | "gray";

// 取り込み時にシステムが自動で入れる行。これだけなら「備考なし」と数える。
const AUTO_LINE_PATTERNS: RegExp[] = [
  /^(ホットペッパー|食べログ|一休)予約$/,
  /^(食べログ)?席情報[:：]/,
  /^メール(コース|プラン)名[:：]/,
  /^予約変更の記録/,
  /^ポイント利用[:：]/,
  /^ふりがな[:：]/,
  /^人数[:：]/,
  /^決済方法[:：]/,
  // 変更・キャンセル通知を受信したときの追記行
  /^(ホットペッパー|食べログ|一休)[:：]\s*(変更|キャンセル)通知を受信/,
  /^キャンセル理由[:：]/,
  // 自社サイト（クリスマス）申込の自動行
  /（自社サイト）$/,
  /^キャンセルポリシーに同意済み$/,
];

// 要望などが入る見出し行（「見出し:」の後ろ、または次の行以降に本文が来る）
const CONTENT_HEADER = /^(ご要望事項|コメント|苦手なもの・アレルギー|アレルギー・苦手な食材)[:：]\s*(.*)$/;

// 「なし」と同じ意味の値は、要望として数えない
const NONE_LIKE = /^(なし|無し|特になし|特に無し|ありません|特にありません|-|ー|－|—)$/;

function isEmptyValue(value: string) {
  const v = value.trim().replace(/[。.]$/, "");
  return v === "" || NONE_LIKE.test(v);
}

// 備考のうち、お客様の要望やスタッフが手で書いた行だけを取り出す。
// 自動で入る行（取り込み元・席情報・コース名・ポイント・変更の記録など）と、
// 見出しだけ・「なし」の行は含めない。枠に備考を出すときもこの結果を使う。
export function realNoteLines(notes: string | null | undefined): string[] {
  if (!notes) return [];

  const result: string[] = [];
  for (const raw of String(notes).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (AUTO_LINE_PATTERNS.some((p) => p.test(line))) continue;

    const header = CONTENT_HEADER.exec(line);
    if (header) {
      // 見出しだけ・「なし」の行は無視。値があれば備考あり
      if (!isEmptyValue(header[2])) result.push(line);
      continue;
    }

    // 見出しの次の行などの本文。「なし」だけなら無視
    if (isEmptyValue(line)) continue;
    result.push(line);
  }
  return result;
}

// 備考欄に、お客様の要望やスタッフが手で書いた内容があるか。
export function hasRealNotes(notes: string | null | undefined): boolean {
  return realNoteLines(notes).length > 0;
}

// コース名が「席のみ」（またはコース未設定）か。
// 「席のみ」「お席のみのご予約」「(ディナー)席のみ予約」などをまとめて席のみ扱いにする。
export function isSeatOnlyCourse(courseName: string | null | undefined): boolean {
  const name = String(courseName ?? "").trim();
  if (!name) return true;
  return name.includes("席のみ");
}

export function getReservationTone(r: {
  status?: string | null;
  notes?: string | null;
  courseName?: string | null;
}): ReservationTone {
  if (r.status === "cancelled") return "gray";
  if (hasRealNotes(r.notes)) return "red";
  if (!isSeatOnlyCourse(r.courseName)) return "yellow";
  return "blue";
}

// 枠の色（淡い背景＋読みやすい濃い文字）。Tailwind のクラス名は静的に書く。
export const TONE_STYLES: Record<
  ReservationTone,
  { label: string; box: string; sub: string; swatch: string }
> = {
  red: {
    label: "備考あり",
    box: "border-rose-300 bg-rose-100 text-rose-950 hover:ring-rose-300",
    sub: "text-rose-800",
    swatch: "border-rose-300 bg-rose-100",
  },
  yellow: {
    label: "コースあり（備考なし）",
    box: "border-amber-300 bg-amber-100 text-amber-950 hover:ring-amber-300",
    sub: "text-amber-900",
    swatch: "border-amber-300 bg-amber-100",
  },
  blue: {
    label: "席のみ（備考なし）",
    box: "border-sky-300 bg-sky-100 text-sky-950 hover:ring-sky-300",
    sub: "text-sky-900",
    swatch: "border-sky-300 bg-sky-100",
  },
  gray: {
    label: "キャンセル済み",
    box: "border-stone-300 bg-stone-200 text-stone-600 hover:ring-stone-300",
    sub: "text-stone-600",
    swatch: "border-stone-300 bg-stone-200",
  },
};
