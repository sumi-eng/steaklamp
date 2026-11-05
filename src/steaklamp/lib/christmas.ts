// クリスマスコースの設定と、上限・受付可否の判定ロジック。
// DBに依存しない純粋関数だけを置き、テストできるようにしている。

export const CHRISTMAS = {
  courseName: "クリスマスコース",
  price: 11000,
  dates: ["2026-12-24", "2026-12-25"],
  times: ["18:00", "18:30", "19:00", "19:30"],
  maxGroups: 6,
  maxPersons: 12,
  minPartySize: 2,
  maxPartySize: 4,
  durationMinutes: 120,
  opensAt: "2026-11-06T00:00:00+09:00",
  closesAt: "2026-12-20T23:59:59+09:00",
  // Webからの無料キャンセルは、来店の2日前まで（cancel API の既存ルール）
  phone: "088-661-1536",
} as const;

// コース内容（料理）。確定したら1行ずつ追加する。空の間は画面・メールに表示しない。
export const CHRISTMAS_MENU: string[] = [];

export const CHRISTMAS_CANCEL_POLICY: string[] = [
  "ご来店の2日前まで：Webのキャンセルページから、キャンセル料なしでお取り消しいただけます。",
  "前日・当日のキャンセル・ご変更はお電話（" + CHRISTMAS.phone + "）にてお願いいたします。",
  "キャンセル料：前日はコース料金の50%、当日はコース料金の100%がかかります。",
];

export const CHRISTMAS_PRICE_TEXT = `${CHRISTMAS.price.toLocaleString()}円（税込）`;


export type ChristmasRow = {
  id: string;
  created_at?: string | null;
  start_at: string;
  persons: number | null;
  status?: string | null;
  course_name_snapshot?: string | null;
};

export function isChristmasCourse(name: string | null | undefined) {
  return String(name ?? "").includes("クリスマス");
}

export function isChristmasDate(dateKey: string) {
  return (CHRISTMAS.dates as readonly string[]).includes(dateKey);
}

// 日付（YYYY-MM-DD）を日本時間で返す
export function jstDateKey(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function jstTimeKey(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function isReceptionOpen(now: Date = new Date()) {
  return (
    now.getTime() >= new Date(CHRISTMAS.opensAt).getTime() &&
    now.getTime() <= new Date(CHRISTMAS.closesAt).getTime()
  );
}

export function dateLabel(dateKey: string) {
  const [, m, d] = dateKey.split("-").map(Number);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][
    new Date(`${dateKey}T12:00:00+09:00`).getUTCDay()
  ];
  return `${m}月${d}日（${wd}）`;
}

// キャンセル・無断キャンセルは枠に数えない
export function countsTowardLimit(row: ChristmasRow) {
  if (["cancelled", "no_show"].includes(String(row.status ?? ""))) return false;
  return isChristmasCourse(row.course_name_snapshot);
}

export function christmasRowsForDate(rows: ChristmasRow[], dateKey: string) {
  return rows.filter(
    (r) => countsTowardLimit(r) && jstDateKey(r.start_at) === dateKey
  );
}

// 登録順（created_at → id）。同時刻でも必ず一意に決まるようにする。
export function compareRegistrationOrder(a: ChristmasRow, b: ChristmasRow) {
  const ta = new Date(a.created_at ?? 0).getTime() || 0;
  const tb = new Date(b.created_at ?? 0).getTime() || 0;
  if (ta !== tb) return ta - tb;
  // ミリ秒が同じなら、マイクロ秒まで含む元の文字列で比べる
  const sa = String(a.created_at ?? "");
  const sb = String(b.created_at ?? "");
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ia = String(a.id);
  const ib = String(b.id);
  if (ia === ib) return 0;
  return ia < ib ? -1 : 1;
}

export type DaySummary = {
  date: string;
  usedGroups: number;
  usedPersons: number;
  remainingGroups: number;
  remainingPersons: number;
  closed: boolean;
  // 上限（6組または12名）に達した、または手動で締め切られた
  full: boolean;
  // 自社ページで受け付けられる最大人数（0なら満席）
  maxSelectablePersons: number;
};

export function summarizeDay(
  rows: ChristmasRow[],
  dateKey: string,
  closed = false
): DaySummary {
  const list = christmasRowsForDate(rows, dateKey);
  const usedGroups = list.length;
  const usedPersons = list.reduce((sum, r) => sum + Number(r.persons ?? 0), 0);
  const remainingGroups = Math.max(0, CHRISTMAS.maxGroups - usedGroups);
  const remainingPersons = Math.max(0, CHRISTMAS.maxPersons - usedPersons);
  const limitReached = remainingGroups <= 0 || remainingPersons <= 0;
  const maxSelectablePersons =
    closed || limitReached
      ? 0
      : Math.min(CHRISTMAS.maxPartySize, remainingPersons);
  return {
    date: dateKey,
    usedGroups,
    usedPersons,
    remainingGroups,
    remainingPersons,
    closed,
    full: closed || limitReached,
    // 残り1名では最少人数（2名）に満たないので、自社ページでは受け付けられない
    maxSelectablePersons:
      maxSelectablePersons >= CHRISTMAS.minPartySize ? maxSelectablePersons : 0,
  };
}

export type OrderEvaluation = {
  // 自分より先に登録された予約だけを数えた結果、上限を超えるか
  over: boolean;
  groupsBefore: number;
  personsBefore: number;
  reason: "groups" | "persons" | null;
};

// 「自分より先に登録された予約」だけを数えて、この予約が上限内かを判定する。
// 後から来た予約だけが満席扱いになり、先に入った予約は影響を受けない。
export function evaluateRegistrationOrder(
  rows: ChristmasRow[],
  target: ChristmasRow,
  dateKey: string
): OrderEvaluation {
  const before = christmasRowsForDate(rows, dateKey).filter(
    (r) => String(r.id) !== String(target.id) && compareRegistrationOrder(r, target) < 0
  );
  const groupsBefore = before.length;
  const personsBefore = before.reduce((sum, r) => sum + Number(r.persons ?? 0), 0);
  const persons = Number(target.persons ?? 0);

  if (groupsBefore + 1 > CHRISTMAS.maxGroups) {
    return { over: true, groupsBefore, personsBefore, reason: "groups" };
  }
  if (personsBefore + persons > CHRISTMAS.maxPersons) {
    return { over: true, groupsBefore, personsBefore, reason: "persons" };
  }
  return { over: false, groupsBefore, personsBefore, reason: null };
}

export type CapacityNotice = "full" | "one_left" | null;

// 予約が1件増えたときに、LINEで知らせるべき状態の変化
export function capacityNotice(
  before: Pick<DaySummary, "remainingGroups" | "remainingPersons">,
  after: Pick<DaySummary, "remainingGroups" | "remainingPersons">
): CapacityNotice {
  const wasFull = before.remainingGroups <= 0 || before.remainingPersons <= 0;
  const isFull = after.remainingGroups <= 0 || after.remainingPersons <= 0;
  if (!wasFull && isFull) return "full";
  if (!isFull && before.remainingGroups > 1 && after.remainingGroups === 1) {
    return "one_left";
  }
  return null;
}

// 外部サイトのプラン名から、クリスマスコースかどうかを判定する。
// A/B/Cコースや金額（11,000円はCコースの旧価格と同額）より先に判定すること。
export function inferChristmasCourse(planName: string | null | undefined) {
  if (!isChristmasCourse(planName)) return null;
  return { courseName: CHRISTMAS.courseName, coursePrice: CHRISTMAS.price };
}

// お客様情報の検証（ページとAPIの両方で使う）。メールアドレスは必須。
export function validateChristmasGuest(args: {
  name: string;
  phone: string;
  email: string;
  allergy: string;
  agreed: boolean;
}): string | null {
  if (!args.name.trim()) return "お名前を入力してください。";
  const digits = args.phone.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 11) {
    return "電話番号は10桁または11桁で入力してください。";
  }
  const email = args.email.trim();
  if (!email) return "メールアドレスを入力してください（予約確認と前日のご案内をお送りします）。";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "メールアドレスの形式をご確認ください。";
  }
  if (!args.allergy.trim()) {
    return "アレルギー・苦手な食材を入力してください（無ければ「なし」）。";
  }
  if (!args.agreed) return "キャンセルポリシーへの同意が必要です。";
  return null;
}

export type SlotCheck =
  | { ok: true }
  | { ok: false; reason: string };

// 自社ページからの予約申込を検証する（サーバー側で必ず実行する）
export function validateChristmasRequest(args: {
  now: Date;
  date: string;
  time: string;
  persons: number;
  summary: DaySummary;
}): SlotCheck {
  if (!isReceptionOpen(args.now)) {
    return { ok: false, reason: "クリスマスコースの受付期間外です。" };
  }
  if (!isChristmasDate(args.date)) {
    return { ok: false, reason: "ご予約できない日付です。" };
  }
  if (!(CHRISTMAS.times as readonly string[]).includes(args.time)) {
    return { ok: false, reason: "ご予約できない開始時刻です。" };
  }
  if (
    !Number.isInteger(args.persons) ||
    args.persons < CHRISTMAS.minPartySize ||
    args.persons > CHRISTMAS.maxPartySize
  ) {
    return {
      ok: false,
      reason: `人数は${CHRISTMAS.minPartySize}〜${CHRISTMAS.maxPartySize}名でお選びください。`,
    };
  }
  if (args.summary.closed) {
    return { ok: false, reason: "この日の受付は終了しました。" };
  }
  if (args.summary.full) {
    return { ok: false, reason: "申し訳ありません。この日は満席です。" };
  }
  if (args.persons > args.summary.remainingPersons) {
    return {
      ok: false,
      reason: `残り${args.summary.remainingPersons}名です。人数を減らしてお選びください。`,
    };
  }
  return { ok: true };
}
