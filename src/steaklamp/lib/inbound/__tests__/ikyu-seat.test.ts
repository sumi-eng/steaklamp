import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 席マスタは実際のもの。DBは最小限のモックに置き換える（hotpepper-seat.test.ts と同じ方式）。
const SEAT_DEFS: [string, number, number][] = [
  ["T1-1", 1, 2], ["T1-2", 1, 2], ["T2-1", 1, 2], ["T2-2", 1, 2], ["T3-1", 1, 2], ["T3-2", 1, 2],
  ["右テーブル", 2, 4], ["中テーブル", 2, 2], ["左テーブル", 2, 4],
  ["左6名席", 4, 6], ["右6名席", 4, 6], ["右8名席", 7, 8], ["全テーブル", 9, 12],
  ["C1", 1, 1], ["C2", 1, 1], ["C3", 1, 1], ["C4", 1, 1], ["C5", 1, 1], ["C6", 1, 1], ["C7", 1, 1], ["C8", 1, 1],
  ["C-12", 2, 2], ["C-45", 2, 2], ["C-78", 2, 2], ["C-123", 3, 3], ["C-678", 3, 3], ["C-3456", 4, 4],
];
const SEATS = SEAT_DEFS.map(([name, min, max], i) => ({
  id: `seat-${name}`,
  name,
  min_persons: min,
  max_persons: max,
  is_active: true,
  is_reservable: true,
  sort_order: i + 1,
}));

const state = vi.hoisted(() => ({ inserts: [] as any[] }));

vi.mock("@/steaklamp/lib/supabaseAdmin", () => {
  const result = (table: string, op: string) => {
    if (table === "stores") return { data: { id: "store-1", code: "steaklamp" }, error: null };
    if (table === "seats") return { data: SEATS, error: null };
    if (table === "seat_members") return { data: [], error: null };
    if (op === "insert") return { data: { id: "new-1", status: "booked" }, error: null };
    return { data: null, error: null }; // 既存予約なし
  };

  return {
    supabaseAdmin: {
      from(table: string) {
        let op = "select";
        const b: any = {
          select: () => b,
          eq: () => b,
          gte: () => b,
          lte: () => b,
          order: () => b,
          insert: (payload: any) => {
            op = "insert";
            state.inserts.push(payload);
            return b;
          },
          single: () => Promise.resolve(result(table, op)),
          maybeSingle: () => Promise.resolve(result(table, op)),
          then: (ok: any, ng: any) =>
            Promise.resolve(table === "reservations" ? { data: [], error: null } : result(table, op)).then(ok, ng),
        };
        return b;
      },
    },
  };
});

vi.mock("@/steaklamp/lib/lineNotify", () => ({
  sendLineReservationNotice: vi.fn(async () => undefined),
  sendLineReviewNotice: vi.fn(async () => undefined),
}));

import { importIkyuReservationFromText } from "../ikyu-import";

// 実メール(新規)の書式。席管理名称だけ差し替えて、席種ごとの割り当てを確認する。
const LINE = "---------------------------------------------------------------------";
const mail = (seatLines: string, persons = "2人") => `${LINE}
◆【新規】予約受付のお知らせ◆（席のみ）（通知NO：10000005）
${LINE}
Lamp 御中

●予約サイト　　　：一休.comレストラン
●予約番号　　　　：IR0559295999
●来店日時　　　　：2026年10月22日（木） 18:00
●滞在時間（目安）：150分
●決済方法　　　　：現地決済
●来店人数　　　　：${persons}
●プランNo　　　　：12840052
●プラン　　　　　：(ディナー)席のみ予約
●席No　　　　　　：20596650
●席管理名称　　　：${seatLines}

${LINE}
●来店代表者氏名　：〇〇 〇〇
●来店代表者連絡先：090XXXXXXXX
●コメント　　　　：なし
`;

const COUNTER_LABEL = "1名/カウンター/コネクト可/8卓\n　　　　　　　　　　カウンター(禁煙)（×2卓）";
const TABLE_LABEL = "2~4名/テーブル/コネクト可/3卓\n　　　　　　　　　　テーブル席(禁煙)（×1卓）";
const SUBJECT = "【新規_現地決済】予約受付のお知らせ [予約NO：IR0559295999] 通知NO：10000005";

describe("一休の席割り当て（席管理名称の席種）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T00:00:00+09:00"));
    state.inserts = [];
  });
  afterEach(() => vi.useRealTimers());

  it("席管理名称が「カウンター」の2名は、右テーブルではなくカウンター席に割り当てる", async () => {
    const result: any = await importIkyuReservationFromText({ rawText: mail(COUNTER_LABEL), subject: SUBJECT });
    expect(result.action).toBe("created");
    expect(result.assignedSeatName).toBe("C-12");
    expect(state.inserts[0].seat_id).toBe("seat-C-12");
    expect(state.inserts[0].counter_acceptable).toBe(true);
  });

  it("席管理名称が「カウンター」の1名は C1", async () => {
    const result: any = await importIkyuReservationFromText({ rawText: mail(COUNTER_LABEL, "1人"), subject: SUBJECT });
    expect(result.assignedSeatName).toBe("C1");
  });

  it("席管理名称が「テーブル」の2名はテーブル席に割り当てる", async () => {
    const result: any = await importIkyuReservationFromText({ rawText: mail(TABLE_LABEL), subject: SUBJECT });
    expect(result.assignedSeatName).toBe("右テーブル");
    expect(state.inserts[0].counter_acceptable).toBe(false);
  });
});
