import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let reservationRows: any[] = [];
let closedRows: any[] = [];

vi.mock("@/steaklamp/lib/lineNotify", () => ({
  sendLineText: vi.fn(async (text: string) => {
    sent.push(text);
  }),
}));

// supabase のクエリビルダーの代わりに、テーブル名ごとに固定の行を返す
vi.mock("@/steaklamp/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from(table: string) {
      const result = () => ({
        data: table === "reservations" ? reservationRows : closedRows,
        error: null,
      });
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        then: (resolve: any) => resolve(result()),
      };
      return builder;
    },
  },
}));

import { afterChristmasReservationSaved } from "../christmas-server";

let seq = 0;
function row(persons = 2, over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `r-${String(seq).padStart(3, "0")}`,
    created_at: `2026-11-10T00:00:${String(seq).padStart(2, "0")}.000000+00:00`,
    start_at: "2026-12-24T18:00:00+09:00",
    persons,
    status: "booked",
    course_name_snapshot: "クリスマスコース",
    ...over,
  };
}

async function run(target: { id: string }) {
  return afterChristmasReservationSaved({
    storeId: "store-1",
    reservationId: target.id,
    sourceLabel: "ホットペッパー",
  });
}

beforeEach(() => {
  sent.length = 0;
  seq = 0;
  closedRows = [];
  reservationRows = [];
});

describe("クリスマス予約の保存後の通知", () => {
  it("余裕があれば通知しない", async () => {
    reservationRows = [row(), row()];
    const res = await run(reservationRows[1]);
    expect(res).toEqual({ over: false, notified: null });
    expect(sent).toHaveLength(0);
  });

  it("5組目で「残り1組」を通知する", async () => {
    reservationRows = Array.from({ length: 5 }, () => row());
    const res = await run(reservationRows[4]);
    expect(res.notified).toBe("one_left");
    expect(sent[0]).toContain("12/24");
    expect(sent[0]).toContain("残り1組");
  });

  it("6組目で満席を通知する（受付を止める依頼を含む）", async () => {
    reservationRows = Array.from({ length: 6 }, () => row());
    const res = await run(reservationRows[5]);
    expect(res.notified).toBe("full");
    expect(sent[0]).toContain(
      "12/24 満席になりました。ホットペッパー・食べログ・一休の受付を止めてください"
    );
  });

  it("12名に達した予約でも満席を通知する", async () => {
    reservationRows = [row(4), row(4), row(4)];
    const res = await run(reservationRows[2]);
    expect(res.notified).toBe("full");
  });

  it("上限を超えた予約は「上限超過・要確認」を通知する（満席通知は出さない）", async () => {
    reservationRows = Array.from({ length: 7 }, () => row());
    const res = await run(reservationRows[6]);
    expect(res).toEqual({ over: true, notified: "over" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("上限超過・要確認");
    expect(sent[0]).toContain("ホットペッパー");
    expect(sent[0]).not.toContain("満席になりました");
  });

  it("上限を超えた予約より先に入っていた予約は、後から数えても超過にならない", async () => {
    reservationRows = Array.from({ length: 7 }, () => row());
    const res = await run(reservationRows[5]); // 6組目（先着）
    expect(res.over).toBe(false);
  });

  it("クリスマス以外のコースや対象日以外は何もしない", async () => {
    reservationRows = [row(2, { course_name_snapshot: "Cコース" })];
    expect(await run(reservationRows[0])).toEqual({ over: false, notified: null });

    reservationRows = [row(2, { start_at: "2026-12-26T18:00:00+09:00" })];
    expect(await run(reservationRows[0])).toEqual({ over: false, notified: null });
    expect(sent).toHaveLength(0);
  });
});
