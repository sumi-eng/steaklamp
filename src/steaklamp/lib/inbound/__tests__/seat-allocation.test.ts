import { describe, expect, it } from "vitest";
import {
  capacityMismatchMessage,
  chooseSeat,
  evaluateSeatAssignment,
  noSeatMessage,
  type ReservationRow,
  type SeatMemberRow,
  type SeatRow,
} from "../seat-allocation";

// 実際の席マスタ（名前・最小/最大人数）
const SEAT_DEFS: [string, number, number][] = [
  ["T1-1", 1, 2], ["T1-2", 1, 2], ["T2-1", 1, 2], ["T2-2", 1, 2], ["T3-1", 1, 2], ["T3-2", 1, 2],
  ["右テーブル", 2, 4], ["中テーブル", 2, 2], ["左テーブル", 2, 4],
  ["左6名席", 4, 6], ["右6名席", 4, 6], ["右8名席", 7, 8], ["全テーブル", 9, 12],
  ["C1", 1, 1], ["C2", 1, 1], ["C3", 1, 1], ["C4", 1, 1], ["C5", 1, 1], ["C6", 1, 1], ["C7", 1, 1], ["C8", 1, 1],
  ["C-12", 2, 2], ["C-45", 2, 2], ["C-78", 2, 2], ["C-123", 3, 3], ["C-678", 3, 3], ["C-3456", 4, 4],
];
const SEATS: SeatRow[] = SEAT_DEFS.map(([name, min, max], i) => ({
  id: `seat-${name}`,
  name,
  min_persons: min,
  max_persons: max,
  is_active: true,
  is_reservable: true,
  sort_order: i + 1,
}));

const startAt = new Date("2026-10-22T20:00:00+09:00");

const booked = (id: string, seatName: string, start = "2026-10-22T20:00:00+09:00"): ReservationRow => ({
  id,
  seat_id: `seat-${seatName}`,
  start_at: new Date(start).toISOString(),
  duration_minutes: 120,
  status: "booked",
});

const choose = (over: Partial<Parameters<typeof chooseSeat>[0]>) =>
  chooseSeat({
    seats: SEATS,
    members: [],
    reservations: [],
    persons: 2,
    startAt,
    duration: 120,
    counterOk: false,
    ...over,
  });

describe("変更時の席の維持", () => {
  it("元の席が空いていればそのまま維持する（先頭の候補ではなく元の席）", () => {
    const r = choose({ preferSeatId: "seat-左テーブル" });
    expect(r.seat?.name).toBe("左テーブル");
    expect(r.keptExisting).toBe(true);
  });

  it("元の予約自身が占有している席は空きとして扱い、維持できる", () => {
    const r = choose({
      preferSeatId: "seat-左テーブル",
      excludeReservationId: "mine",
      reservations: [booked("mine", "左テーブル")],
    });
    expect(r.seat?.name).toBe("左テーブル");
    expect(r.keptExisting).toBe(true);
  });

  it("元の席が他の予約で埋まっていれば選び直す", () => {
    const r = choose({
      preferSeatId: "seat-左テーブル",
      excludeReservationId: "mine",
      reservations: [booked("mine", "左テーブル", "2026-10-22T19:00:00+09:00"), booked("other", "左テーブル")],
    });
    expect(r.keptExisting).toBe(false);
    expect(r.seat?.name).toBe("右テーブル");
  });

  it("新しい人数が元の席の定員から外れても、元の席が空いていれば維持して警告対象にする", () => {
    // 中テーブルは最大2名。3名に変更されても、手動で入れた席の可能性があるので動かさない
    const r = choose({ persons: 3, preferSeatId: "seat-中テーブル" });
    expect(r.keptExisting).toBe(true);
    expect(r.capacityMismatch).toBe(true);
    expect(r.seat?.name).toBe("中テーブル");
    expect(capacityMismatchMessage({ seat: r.seat!, persons: 3, sourceLabel: "食べログ" })).toBe(
      "食べログの変更で人数が3名になりましたが、席「中テーブル」（2〜2名）のままです。席を確認してください。"
    );
  });

  it("手動で入れたカウンター単独席(C1)に3名の変更メールが来ても、C1が空いていれば維持する", () => {
    const r = choose({ persons: 3, preferSeatId: "seat-C1", excludeReservationId: "mine", reservations: [booked("mine", "C1")] });
    expect(r.seat?.name).toBe("C1");
    expect(r.keptExisting).toBe(true);
    expect(r.capacityMismatch).toBe(true);
  });

  it("定員の範囲内の維持では capacityMismatch にならない", () => {
    const r = choose({ preferSeatId: "seat-左テーブル" });
    expect(r.capacityMismatch).toBe(false);
  });

  it("定員外でも、元の席が他の予約で埋まっていれば選び直す", () => {
    const r = choose({ persons: 3, preferSeatId: "seat-中テーブル", reservations: [booked("other", "中テーブル")] });
    expect(r.keptExisting).toBe(false);
    expect(r.seat?.name).toBe("右テーブル");
  });

  it("元の席が無い(未割当だった)ときは通常の選択", () => {
    const r = choose({ preferSeatId: null });
    expect(r.seat?.name).toBe("右テーブル");
    expect(r.keptExisting).toBe(false);
  });
});

describe("席を割り当てられなかった理由", () => {
  it("1名でカウンター不可: 座れるのはカウンターだけ → counter_only", () => {
    const r = choose({ persons: 1, counterOk: false });
    expect(r.seat).toBeNull();
    expect(r.reason).toBe("counter_only");
    expect(noSeatMessage({ reason: r.reason!, persons: 1, counterOk: false, sourceLabel: "ホットペッパー" })).toBe(
      "ホットペッパーからの予約ですが、1名様が座れる席はカウンター席のみです。カウンターで案内できるか確認してください。"
    );
  });

  it("1名でカウンター可: カウンターが全部埋まっている → full", () => {
    const reservations = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"].map((n) => booked(`r-${n}`, n));
    const r = choose({ persons: 1, counterOk: true, reservations });
    expect(r.seat).toBeNull();
    expect(r.reason).toBe("full");
    expect(noSeatMessage({ reason: r.reason!, persons: 1, counterOk: true, sourceLabel: "一休" })).toBe(
      "一休からの予約ですが、1名で座れるカウンター席に空きがありません。手動で席を確認してください。"
    );
  });

  it("1名でカウンター可: 空きがあれば割り当てる", () => {
    const r = choose({ persons: 1, counterOk: true, reservations: [booked("a", "C1")] });
    expect(r.seat?.name).toBe("C2");
  });

  it("2名でカウンター不可: テーブル席が全部埋まっている → full（カウンター変更の確認を促す）", () => {
    const reservations = ["右テーブル", "中テーブル", "左テーブル"].map((n) => booked(`r-${n}`, n));
    const r = choose({ persons: 2, counterOk: false, reservations });
    expect(r.reason).toBe("full");
    expect(noSeatMessage({ reason: r.reason!, persons: 2, counterOk: false, sourceLabel: "食べログ" })).toBe(
      "食べログからの予約ですが、2名様のテーブル席に空きがありません。カウンターへの変更が可能か確認してください。"
    );
  });

  it("空いているのに満席とは言わない（席が空いていれば割り当てて理由は無し）", () => {
    const r = choose({ persons: 2, counterOk: false, reservations: [booked("a", "右テーブル")] });
    expect(r.seat?.name).toBe("中テーブル");
    expect(r.reason).toBeNull();
  });

  it("人数に合う席が席マスタに無い → capacity", () => {
    const r = choose({ persons: 13, counterOk: true });
    expect(r.reason).toBe("capacity");
    expect(noSeatMessage({ reason: r.reason!, persons: 13, counterOk: true, sourceLabel: "ホットペッパー" })).toBe(
      "ホットペッパーからの予約ですが、13名様に合う席がありません。手動で席を確認してください。"
    );
  });
});

describe("席種(カウンター)の指定", () => {
  it("カウンター指定の2名は、先頭のテーブル席ではなくカウンター席(C-12)に割り当てる", () => {
    const r = choose({ persons: 2, counterOk: true, seatKind: "counter" });
    expect(r.seat?.name).toBe("C-12");
  });

  it("カウンター指定の1名は C1", () => {
    expect(choose({ persons: 1, counterOk: true, seatKind: "counter" }).seat?.name).toBe("C1");
  });

  it("カウンター指定で2名のカウンター席が全部埋まっていたら、テーブルにはせず空き無しにする", () => {
    const reservations = ["C-12", "C-45", "C-78"].map((n) => booked(`r-${n}`, n));
    const r = choose({ persons: 2, counterOk: true, seatKind: "counter", reservations });
    expect(r.seat).toBeNull();
    expect(r.reason).toBe("full");
    expect(
      noSeatMessage({ reason: r.reason!, persons: 2, counterOk: true, seatKind: "counter", sourceLabel: "一休" })
    ).toBe("一休からの予約ですが、2名様のカウンター席に空きがありません。手動で席を確認してください。");
  });

  it("テーブル指定は従来どおりテーブルに割り当てる", () => {
    expect(choose({ persons: 2, counterOk: false, seatKind: "table" }).seat?.name).toBe("右テーブル");
  });
});

describe("手動の席変更の判定 (evaluateSeatAssignment)", () => {
  const seat = (name: string) => SEATS.find((x) => x.name === name)!;
  const members: SeatMemberRow[] = [
    { group_seat_id: "seat-右テーブル", member_seat_id: "seat-T1-1" },
    { group_seat_id: "seat-右テーブル", member_seat_id: "seat-T1-2" },
    { group_seat_id: "seat-C-12", member_seat_id: "seat-C1" },
    { group_seat_id: "seat-C-12", member_seat_id: "seat-C2" },
    { group_seat_id: "seat-C-123", member_seat_id: "seat-C1" },
    { group_seat_id: "seat-C-123", member_seat_id: "seat-C2" },
    { group_seat_id: "seat-C-123", member_seat_id: "seat-C3" },
  ];
  const evalSeat = (name: string, over: Partial<Parameters<typeof evaluateSeatAssignment>[0]> = {}) =>
    evaluateSeatAssignment({
      seat: seat(name),
      members,
      reservations: [],
      persons: 2,
      startAt,
      duration: 120,
      ...over,
    });

  it("テーブル席からカウンター席へ変更できる（自分の予約は重なりに数えない）", () => {
    const mine = booked("mine", "右テーブル");
    const r = evalSeat("C-12", { reservations: [mine], excludeReservationId: "mine" });
    expect(r.conflicts).toHaveLength(0);
    expect(r.fitsPersons).toBe(true);
  });

  it("自分の予約の旧枠と時間をずらしても、自分自身とは重ならない", () => {
    const mine = booked("mine", "C-12");
    const r = evalSeat("C-12", {
      reservations: [mine],
      excludeReservationId: "mine",
      startAt: new Date("2026-10-22T20:30:00+09:00"),
    });
    expect(r.conflicts).toHaveLength(0);
  });

  it("グループ席は構成する物理席で重なりを見る（C-123 を取るとき C2 の予約と重なる）", () => {
    const other = { ...booked("other", "C2"), name: "山田" };
    const r = evalSeat("C-123", { persons: 3, reservations: [other] });
    expect(r.conflicts.map((c) => c.name)).toEqual(["山田"]);
  });

  it("グループ席の予約がある席に、単独席の物理席は重なる（右テーブル予約中にT1-1）", () => {
    const r = evalSeat("T1-1", { reservations: [booked("other", "右テーブル")] });
    expect(r.conflicts).toHaveLength(1);
  });

  it("時間帯が重ならなければ同じ席でも空き / キャンセル済みは数えない", () => {
    const later = booked("later", "C1", "2026-10-22T22:00:00+09:00");
    const cancelled = { ...booked("c", "C1"), status: "cancelled" };
    const r = evalSeat("C1", { persons: 1, reservations: [later, cancelled] });
    expect(r.conflicts).toHaveLength(0);
  });

  it("人数が席の定員に合わない場合は fitsPersons=false（3名にC1だけ）", () => {
    expect(evalSeat("C1", { persons: 3 }).fitsPersons).toBe(false);
    expect(evalSeat("C-123", { persons: 3 }).fitsPersons).toBe(true);
  });
});
