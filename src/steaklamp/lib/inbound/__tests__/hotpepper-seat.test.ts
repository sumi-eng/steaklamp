import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 席マスタは実際のもの（名前・最小/最大人数）。DBは最小限のモックに置き換える。
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

const state = vi.hoisted(() => ({
  existing: null as any,
  updates: [] as any[],
}));

vi.mock("@/steaklamp/lib/supabaseAdmin", () => {
  const result = (table: string, op: string) => {
    if (table === "stores") return { data: { id: "store-1", code: "steaklamp" }, error: null };
    if (table === "seats") return { data: SEATS, error: null };
    if (table === "seat_members") return { data: [], error: null };
    if (op === "update") return { data: { id: state.existing.id, status: "booked" }, error: null };
    return { data: state.existing, error: null };
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
          update: (payload: any) => {
            op = "update";
            state.updates.push(payload);
            return b;
          },
          single: () => Promise.resolve(result(table, op)),
          maybeSingle: () => Promise.resolve(result(table, op)),
          // 一覧取得（await）: reservations は既存の1件のみ（席未割当なので占有しない）
          then: (ok: any, ng: any) =>
            Promise.resolve(
              table === "reservations"
                ? { data: state.existing ? [state.existing] : [], error: null }
                : result(table, op)
            ).then(ok, ng),
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

import { detectSeatKind, parseHotpepperReservationMail } from "../hotpepper-parser";
import { importHotpepperReservationFromText } from "../hotpepper-import";

// 全角のまま（「～」「８」）の変更メール。席情報は2行（C1～８ / カウンター（喫煙可））、1名。
const COUNTER_CHANGE_MAIL = `「隠れ家ダイニング Lamp 徳島秋田町店」様
レストランボード・ホットペッパーグルメからのお知らせです。

【即予約】の変更

■予約経路：ホットペッパーグルメ
■予約依頼番号：SE3900001
■代表者：テスト　タロウ様
■コース：お席のみのご予約
■席情報：C1～８
　　　　　カウンター（喫煙可）
■ポイント利用額：0ポイント

【予約変更内容】
■来店日時：2026年10月22日(木) 19:00 → 2026年10月22日(木) 20:00
■人数：1名様 → 1名様
`;

const TABLE_MAIL = COUNTER_CHANGE_MAIL.replace(
  "■席情報：C1～８\n　　　　　カウンター（喫煙可）",
  "■席情報：Ｔ1～Ｔ３\n　　　　　テーブル（喫煙可）"
).replace("1名様 → 1名様", "2名様 → 2名様");

const SUBJECT = "[即予約]予約内容が変更されました";

describe("席種の判定", () => {
  it.each([
    ["C1～８\nカウンター（喫煙可）", "counter"],
    ["C1～８", "counter"], // 2行目が無くても「C1～8」形式でカウンターと判定
    ["Ｃ１～Ｃ８", "counter"],
    ["カウンター", "counter"],
    ["Ｔ1～Ｔ３\nテーブル（喫煙可）", "table"],
    ["Ｔ1～Ｔ３", "table"],
    ["", "unknown"],
  ])("%j → %s", (label, expected) => {
    expect(detectSeatKind(label)).toBe(expected);
  });

  it("席情報の2行目まで読み取る", () => {
    const p = parseHotpepperReservationMail(COUNTER_CHANGE_MAIL, SUBJECT);
    expect(p.seatLabel).toBe("C1～８\nカウンター（喫煙可）");
    expect(p.seatKind).toBe("counter");
  });
});

describe("変更メールの席割り当て", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T00:00:00+09:00"));
    state.updates = [];
    // 席未割当(unassigned)になっていた既存の予約
    state.existing = {
      id: "res-1",
      status: "booked",
      session_id: null,
      name: "テスト　タロウ",
      persons: 1,
      start_at: "2026-10-22T10:00:00+00:00",
      notes: "ホットペッパー予約\n苦手なもの・アレルギー:エビ",
      seat_id: null,
      duration_minutes: 120,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("全角の「C1～８」＋「カウンター」の1名予約をカウンター(C1)に割り当てる", async () => {
    const result: any = await importHotpepperReservationFromText({
      rawText: COUNTER_CHANGE_MAIL,
      subject: SUBJECT,
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("updated");
    expect(result.assignmentStatus).toBe("assigned");
    expect(result.assignedSeatName).toBe("C1");
    expect(result.warningMessage).toBeNull();

    const update = state.updates[0];
    expect(update.seat_id).toBe("seat-C1");
    expect(update.counter_acceptable).toBe(true);
    expect(update.start_at).toBe("2026-10-22T11:00:00.000Z"); // JST 20:00
    // 既存の備考(アレルギー)は残る
    expect(update.notes).toContain("苦手なもの・アレルギー:エビ");
  });

  it("テーブル席の2名予約はテーブルに割り当てる（カウンターにならない）", async () => {
    state.existing.persons = 2;
    const result: any = await importHotpepperReservationFromText({
      rawText: TABLE_MAIL,
      subject: SUBJECT,
    });

    expect(result.assignmentStatus).toBe("assigned");
    expect(result.assignedSeatName).toBe("右テーブル");
    expect(state.updates[0].counter_acceptable).toBe(false);
  });
});

describe("変更メールでの席の維持と警告文（取り込み全体）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T00:00:00+09:00"));
    state.updates = [];
    state.existing = {
      id: "res-2",
      status: "booked",
      session_id: null,
      name: "テスト　タロウ",
      persons: 2,
      start_at: "2026-10-22T10:00:00+00:00",
      notes: "ホットペッパー予約",
      seat_id: "seat-左テーブル", // 先頭候補(右テーブル)ではない席に入っていた
      duration_minutes: 120,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("元の席が空いていれば、変更後もそのまま同じ席にする", async () => {
    const result: any = await importHotpepperReservationFromText({ rawText: TABLE_MAIL, subject: SUBJECT });
    expect(result.assignedSeatName).toBe("左テーブル");
    expect(state.updates[0].seat_id).toBe("seat-左テーブル");
  });

  it("1名のテーブル席予約: 空いていても出ていた「満席」ではなく、実際の理由を警告する", async () => {
    state.existing.persons = 1;
    state.existing.seat_id = null;
    const mail = TABLE_MAIL.replace("2名様 → 2名様", "1名様 → 1名様");
    const result: any = await importHotpepperReservationFromText({ rawText: mail, subject: SUBJECT });

    expect(result.assignmentStatus).toBe("unassigned");
    expect(result.warningMessage).toBe(
      "ホットペッパーからの予約ですが、1名様が座れる席はカウンター席のみです。カウンターで案内できるか確認してください。"
    );
    expect(result.warningMessage).not.toContain("満席");
  });
});
