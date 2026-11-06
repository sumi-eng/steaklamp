import { describe, expect, it } from "vitest";
import {
  chooseSeat,
  effectiveSeatIds,
  evaluateSeatSelection,
  judgeLinkedCapacity,
  normalizeSeatIds,
  reservationPhysicalSeatIds,
  sameSeatSet,
  seatLabelOf,
  type ReservationRow,
  type SeatLinkMap,
  type SeatMemberRow,
  type SeatRow,
} from "../seat-allocation";

// 物理席: T1-1,T1-2,T2-1,T2-2,T3-1,T3-2 は 1〜2名、C1〜C8 は 1名。グループ席: 右テーブル=T1-1+T1-2, C-12=C1+C2
const DEFS: [string, number, number][] = [
  ["T1-1", 1, 2], ["T1-2", 1, 2], ["T2-1", 1, 2], ["T2-2", 1, 2], ["T3-1", 1, 2], ["T3-2", 1, 2],
  ["C1", 1, 1], ["C2", 1, 1], ["C3", 1, 1], ["C4", 1, 1], ["C5", 1, 1], ["C6", 1, 1], ["C7", 1, 1], ["C8", 1, 1],
  ["右テーブル", 2, 4], ["中テーブル", 2, 4], ["左テーブル", 2, 4], ["C-12", 2, 2],
];
const SEATS: SeatRow[] = DEFS.map(([name, min, max], i) => ({
  id: `seat-${name}`,
  name,
  min_persons: min,
  max_persons: max,
  is_active: true,
  is_reservable: true,
  sort_order: i + 1,
}));
const id = (name: string) => `seat-${name}`;
const MEMBERS: SeatMemberRow[] = [
  { group_seat_id: id("右テーブル"), member_seat_id: id("T1-1") },
  { group_seat_id: id("右テーブル"), member_seat_id: id("T1-2") },
  { group_seat_id: id("中テーブル"), member_seat_id: id("T2-1") },
  { group_seat_id: id("中テーブル"), member_seat_id: id("T2-2") },
  { group_seat_id: id("左テーブル"), member_seat_id: id("T3-1") },
  { group_seat_id: id("左テーブル"), member_seat_id: id("T3-2") },
  { group_seat_id: id("C-12"), member_seat_id: id("C1") },
  { group_seat_id: id("C-12"), member_seat_id: id("C2") },
];

const startAt = new Date("2026-12-01T19:00:00+09:00");
const resv = (rid: string, seat: string, start = "2026-12-01T19:00:00+09:00"): ReservationRow => ({
  id: rid,
  seat_id: id(seat),
  start_at: new Date(start).toISOString(),
  duration_minutes: 120,
  status: "booked",
});
const links = (entries: Record<string, string[]>): SeatLinkMap =>
  new Map(Object.entries(entries).map(([k, v]) => [k, v.map(id)]));

describe("予約が使っている席（effectiveSeatIds）", () => {
  it("連結なしは従来どおり seat_id だけ", () => {
    expect(effectiveSeatIds({ id: "r1", seat_id: id("右テーブル") })).toEqual([id("右テーブル")]);
    expect(effectiveSeatIds({ id: "r1", seat_id: id("右テーブル") }, new Map())).toEqual([id("右テーブル")]);
  });

  it("席なし(未割当)は空", () => {
    expect(effectiveSeatIds({ id: "r1", seat_id: null }, links({ r1: ["T1-1", "T1-2"] }))).toEqual([]);
  });

  it("連結は代表席(seat_id)が先頭になる", () => {
    const r = { id: "r1", seat_id: id("C3") };
    expect(effectiveSeatIds(r, links({ r1: ["T1-1", "C3", "T1-2"] }))).toEqual([id("C3"), id("T1-1"), id("T1-2")]);
  });

  it("代表席が連結に含まれない古い行は無効（席が埋まったままにならない）", () => {
    const r = { id: "r1", seat_id: id("C3") };
    expect(effectiveSeatIds(r, links({ r1: ["T1-1", "T1-2"] }))).toEqual([id("C3")]);
  });

  it("グループ席と連結を合わせた物理席に展開する", () => {
    const r = { id: "r1", seat_id: id("右テーブル") };
    const phys = reservationPhysicalSeatIds(r, MEMBERS, links({ r1: ["右テーブル", "C3"] }));
    expect([...phys].sort()).toEqual([id("C3"), id("T1-1"), id("T1-2")].sort());
  });
});

describe("evaluateSeatSelection：重なりの判定", () => {
  const base = { seats: SEATS, members: MEMBERS, persons: 4, startAt, duration: 120 };

  it("選んだ席のどれか1つでも他の予約と重なれば conflicts に入る", () => {
    const e = evaluateSeatSelection({
      ...base,
      seatIds: [id("T1-1"), id("T2-1"), id("C3")],
      reservations: [resv("other", "C3")],
    });
    expect(e.conflicts.map((c) => c.id)).toEqual(["other"]);
  });

  it("他の予約がグループ席(右テーブル)でも、物理席T1-2を選ぶと重なる", () => {
    const e = evaluateSeatSelection({
      ...base,
      seatIds: [id("T2-1"), id("T1-2")],
      reservations: [resv("other", "右テーブル")],
    });
    expect(e.conflicts).toHaveLength(1);
  });

  it("他の予約が連結していて、そのうちの1席を選ぶと重なる", () => {
    const e = evaluateSeatSelection({
      ...base,
      seatIds: [id("T3-1"), id("T3-2")],
      reservations: [resv("other", "T1-1")],
      seatLinks: links({ other: ["T1-1", "T3-2"] }),
    });
    expect(e.conflicts.map((c) => c.id)).toEqual(["other"]);
  });

  it("連結の行がなければ、連結先の席は空いている扱い（代表席だけが埋まる）", () => {
    const e = evaluateSeatSelection({
      ...base,
      seatIds: [id("T3-1"), id("T3-2")],
      reservations: [resv("other", "T1-1")],
    });
    expect(e.conflicts).toHaveLength(0);
  });

  it("自分自身の予約・時間帯が重ならない予約・キャンセル済みは除外される", () => {
    const e = evaluateSeatSelection({
      ...base,
      seatIds: [id("T1-1"), id("T1-2")],
      excludeReservationId: "mine",
      reservations: [
        resv("mine", "T1-1"),
        resv("later", "T1-2", "2026-12-01T21:00:00+09:00"),
        { ...resv("cancelled", "T1-2"), status: "cancelled" },
      ],
      seatLinks: links({ mine: ["T1-1", "T1-2"] }),
    });
    expect(e.conflicts).toHaveLength(0);
  });
});

describe("evaluateSeatSelection：定員の判定", () => {
  const base = { seats: SEATS, members: MEMBERS, reservations: [], startAt, duration: 120 };

  it("1席だけなら従来どおり、その席の定員(min〜max)で判定する", () => {
    expect(evaluateSeatSelection({ ...base, persons: 3, seatIds: [id("中テーブル")] }).fitsPersons).toBe(true);
    const out = evaluateSeatSelection({ ...base, persons: 5, seatIds: [id("中テーブル")] });
    expect(out.fitsPersons).toBe(false);
    expect(out.message).toBe("中テーブル は 2〜4名の席です（5名）。");
  });

  it("連結の合計定員が人数に足りないと警告", () => {
    // T1-1+T1-2+C3 = 2+2+1 = 5名分に6名
    const e = evaluateSeatSelection({ ...base, persons: 6, seatIds: [id("T1-1"), id("T1-2"), id("C3")] });
    expect(e.totalMax).toBe(5);
    expect(e.fitsPersons).toBe(false);
    expect(e.message).toContain("席が足りません");
  });

  it("4名でテーブル3つ(6名分)は警告しない", () => {
    const e = evaluateSeatSelection({ ...base, persons: 4, seatIds: [id("T1-1"), id("T2-1"), id("T3-1")] });
    expect(e.totalMax).toBe(6);
    expect(e.fitsPersons).toBe(true);
    expect(e.message).toBeNull();
  });

  it("席の取りすぎ（2名で全テーブルとカウンター）は警告", () => {
    const all = ["T1-1", "T1-2", "T2-1", "T2-2", "T3-1", "T3-2", "C1", "C2", "C3", "C4"].map(id);
    const e = evaluateSeatSelection({ ...base, persons: 2, seatIds: all });
    expect(e.fitsPersons).toBe(false);
    expect(e.message).toContain("多すぎ");
  });

  it("同じ物理席をグループ席と重ねて選んでも二重に数えない", () => {
    const e = evaluateSeatSelection({ ...base, persons: 4, seatIds: [id("右テーブル"), id("T1-1")] });
    expect(e.totalMax).toBe(4);
  });

  it("judgeLinkedCapacity の境界", () => {
    expect(judgeLinkedCapacity(2, 1)).toBe("short");
    expect(judgeLinkedCapacity(2, 4)).toBeNull(); // 2倍まで
    expect(judgeLinkedCapacity(2, 5)).toBeNull(); // 2倍超でも差が4未満
    expect(judgeLinkedCapacity(2, 6)).toBe("oversize");
    expect(judgeLinkedCapacity(18, 18)).toBeNull();
    expect(judgeLinkedCapacity(2, 18)).toBe("oversize");
  });
});

describe("chooseSeat：連結した席の占有と維持", () => {
  const choose = (over: Partial<Parameters<typeof chooseSeat>[0]>) =>
    chooseSeat({
      seats: SEATS,
      members: MEMBERS,
      reservations: [],
      persons: 2,
      startAt,
      duration: 120,
      counterOk: false,
      ...over,
    });

  it("他の予約の連結した席は、すべて使用中として数える（自由連結の右テーブルは選ばれない）", () => {
    // 右テーブル(T1-1+T1-2)は代表席がT2-1の連結の一部として埋まっている
    const r = choose({
      preferSeatId: null,
      reservations: [resv("other", "T2-1")],
      seatLinks: links({ other: ["T2-1", "T1-2"] }),
    });
    expect(r.seat?.name).not.toBe("右テーブル");
    expect(r.seat?.name).not.toBe("中テーブル");
  });

  it("連結したすべての席が空いていれば維持する", () => {
    const r = choose({
      persons: 4,
      preferSeatIds: [id("T1-1"), id("T2-1"), id("C3")],
      excludeReservationId: "mine",
      reservations: [resv("mine", "T1-1")],
      seatLinks: links({ mine: ["T1-1", "T2-1", "C3"] }),
    });
    expect(r.keptExisting).toBe(true);
    expect(r.keptSeatIds).toEqual([id("T1-1"), id("T2-1"), id("C3")]);
    expect(r.seat?.name).toBe("T1-1");
    expect(r.seatLabel).toBe("T1-1・T2-1・C3");
  });

  it("連結した席のうち1席でも他の予約で埋まっていれば、維持せず選び直す", () => {
    const r = choose({
      persons: 2,
      preferSeatIds: [id("T1-1"), id("T2-1"), id("C3")],
      excludeReservationId: "mine",
      reservations: [resv("mine", "T1-1"), resv("other", "C3")],
      seatLinks: links({ mine: ["T1-1", "T2-1", "C3"] }),
    });
    expect(r.keptExisting).toBe(false);
    expect(r.keptSeatIds).toBeUndefined();
    expect(r.seat).not.toBeNull();
  });

  it("人数が増えて連結の定員に足りなくなっても、空いていれば維持して警告対象にする", () => {
    const r = choose({
      persons: 9,
      preferSeatIds: [id("T1-1"), id("T2-1")],
      excludeReservationId: "mine",
      reservations: [resv("mine", "T1-1")],
      seatLinks: links({ mine: ["T1-1", "T2-1"] }),
    });
    expect(r.keptExisting).toBe(true);
    expect(r.capacityMismatch).toBe(true);
  });
});

describe("補助関数", () => {
  it("normalizeSeatIds：文字列化・空除去・重複除去・順序維持", () => {
    expect(normalizeSeatIds(["a", " b ", "", "a", null, 3])).toEqual(["a", "b", "3"]);
    expect(normalizeSeatIds("x")).toEqual([]);
    expect(normalizeSeatIds(undefined)).toEqual([]);
  });

  it("sameSeatSet：順序に関係なく同じ席の集まりか", () => {
    expect(sameSeatSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameSeatSet(["a"], ["a", "b"])).toBe(false);
    expect(sameSeatSet(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("seatLabelOf：席の並び順で「・」区切り", () => {
    expect(seatLabelOf([id("C3"), id("T2-1"), id("T1-1")], SEATS)).toBe("T1-1・T2-1・C3");
  });
});
