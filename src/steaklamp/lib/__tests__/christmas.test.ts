import { describe, expect, it } from "vitest";
import {
  capacityNotice,
  compareRegistrationOrder,
  evaluateRegistrationOrder,
  inferChristmasCourse,
  isChristmasCourse,
  isReceptionOpen,
  jstDateKey,
  summarizeDay,
  validateChristmasRequest,
  type ChristmasRow,
} from "../christmas";

const D24 = "2026-12-24";

let seq = 0;
function row(over: Partial<ChristmasRow> = {}): ChristmasRow {
  seq += 1;
  return {
    id: `id-${String(seq).padStart(3, "0")}`,
    created_at: `2026-11-10T00:00:${String(seq % 60).padStart(2, "0")}.000000+00:00`,
    start_at: "2026-12-24T18:00:00+09:00",
    persons: 2,
    status: "booked",
    course_name_snapshot: "クリスマスコース",
    ...over,
  };
}

describe("判定の基本", () => {
  it("コース名に「クリスマス」を含めばクリスマスコース", () => {
    expect(isChristmasCourse("クリスマスコース")).toBe(true);
    expect(isChristmasCourse("【12/24限定】クリスマスディナー 11,000円")).toBe(true);
    expect(isChristmasCourse("Cコース")).toBe(false);
    expect(isChristmasCourse(null)).toBe(false);
  });

  it("日付は日本時間で判定する", () => {
    expect(jstDateKey("2026-12-24T15:30:00Z")).toBe("2026-12-25");
    expect(jstDateKey("2026-12-24T18:00:00+09:00")).toBe("2026-12-24");
  });

  it("受付期間は11/6 0:00〜12/20 23:59", () => {
    expect(isReceptionOpen(new Date("2026-11-05T23:59:59+09:00"))).toBe(false);
    expect(isReceptionOpen(new Date("2026-11-06T00:00:00+09:00"))).toBe(true);
    expect(isReceptionOpen(new Date("2026-12-20T23:59:59+09:00"))).toBe(true);
    expect(isReceptionOpen(new Date("2026-12-21T00:00:00+09:00"))).toBe(false);
  });
});

describe("残り枠の集計", () => {
  it("組数・人数を数え、キャンセルと他の日・他のコースは数えない", () => {
    const rows = [
      row({ persons: 2 }),
      row({ persons: 4 }),
      row({ persons: 3, status: "cancelled" }),
      row({ persons: 2, start_at: "2026-12-25T18:00:00+09:00" }),
      row({ persons: 2, course_name_snapshot: "Cコース" }),
    ];
    const s = summarizeDay(rows, D24);
    expect(s.usedGroups).toBe(2);
    expect(s.usedPersons).toBe(6);
    expect(s.remainingGroups).toBe(4);
    expect(s.remainingPersons).toBe(6);
    expect(s.full).toBe(false);
    expect(s.maxSelectablePersons).toBe(4);
  });

  it("6組に達したら満席", () => {
    const rows = Array.from({ length: 6 }, () => row({ persons: 2 }));
    const s = summarizeDay(rows, D24);
    expect(s.full).toBe(true);
    expect(s.maxSelectablePersons).toBe(0);
  });

  it("12名に達したら満席（5組でも）", () => {
    const rows = [4, 4, 4].map((p) => row({ persons: p }));
    const s = summarizeDay(rows, D24);
    expect(s.remainingPersons).toBe(0);
    expect(s.full).toBe(true);
  });

  it("残り人数より多い人数は選べない（残り3名なら最大3名）", () => {
    const rows = [4, 4, 1].map((p) => row({ persons: p }));
    expect(summarizeDay(rows, D24).maxSelectablePersons).toBe(3);
  });

  it("残り1名は最少人数に満たないので自社ページでは満席扱い", () => {
    const rows = [4, 4, 3].map((p) => row({ persons: p }));
    const s = summarizeDay(rows, D24);
    expect(s.remainingPersons).toBe(1);
    expect(s.maxSelectablePersons).toBe(0);
  });

  it("手動で締め切ると満席", () => {
    const s = summarizeDay([], D24, true);
    expect(s.full).toBe(true);
    expect(s.maxSelectablePersons).toBe(0);
  });
});

describe("登録順での上限判定", () => {
  it("自分より先の予約だけを数える：後から来た7組目だけが超過になる", () => {
    const rows = Array.from({ length: 7 }, () => row({ persons: 2 }));
    const results = rows.map((r) => evaluateRegistrationOrder(rows, r, D24).over);
    expect(results).toEqual([false, false, false, false, false, false, true]);
  });

  it("同じ入力ならどの順番で渡しても結果は変わらない", () => {
    const rows = Array.from({ length: 7 }, () => row({ persons: 2 }));
    const shuffled = [...rows].reverse();
    const results = rows.map((r) => evaluateRegistrationOrder(shuffled, r, D24).over);
    expect(results).toEqual([false, false, false, false, false, false, true]);
  });

  it("人数の上限：12名を超える予約だけが超過になる", () => {
    const rows = [4, 4, 4, 2].map((p) => row({ persons: p }));
    const results = rows.map((r) => evaluateRegistrationOrder(rows, r, D24));
    expect(results.map((r) => r.over)).toEqual([false, false, false, true]);
    expect(results[3].reason).toBe("persons");
  });

  it("created_at が同時刻なら id の順で決まり、必ず片方だけが通る", () => {
    const t = "2026-11-10T00:00:00.000000+00:00";
    const rows = [
      row({ id: "b", created_at: t, persons: 4 }),
      row({ id: "a", created_at: t, persons: 4 }),
      row({ id: "c", created_at: t, persons: 4 }),
      row({ id: "d", created_at: t, persons: 4 }),
    ];
    const over = Object.fromEntries(
      rows.map((r) => [r.id, evaluateRegistrationOrder(rows, r, D24).over])
    );
    // a,b,c で12名。d だけが超過
    expect(over).toEqual({ a: false, b: false, c: false, d: true });
  });

  it("マイクロ秒の差でも順番を判定する", () => {
    const early = row({ id: "z", created_at: "2026-11-10T00:00:00.123100+00:00" });
    const late = row({ id: "a", created_at: "2026-11-10T00:00:00.123900+00:00" });
    expect(compareRegistrationOrder(early, late)).toBeLessThan(0);
  });

  it("キャンセルされた予約は先着に数えない", () => {
    const rows = [
      ...Array.from({ length: 6 }, () => row({ persons: 2 })),
    ];
    rows[0].status = "cancelled";
    const last = row({ persons: 2 });
    expect(evaluateRegistrationOrder([...rows, last], last, D24).over).toBe(false);
  });

  it("別の日の予約は影響しない", () => {
    const other = Array.from({ length: 6 }, () =>
      row({ start_at: "2026-12-25T18:00:00+09:00" })
    );
    const mine = row();
    expect(evaluateRegistrationOrder([...other, mine], mine, D24).over).toBe(false);
  });
});

describe("LINE通知の判定", () => {
  it("上限に達した予約で満席を通知する", () => {
    expect(
      capacityNotice(
        { remainingGroups: 1, remainingPersons: 5 },
        { remainingGroups: 0, remainingPersons: 3 }
      )
    ).toBe("full");
    expect(
      capacityNotice(
        { remainingGroups: 3, remainingPersons: 2 },
        { remainingGroups: 2, remainingPersons: 0 }
      )
    ).toBe("full");
  });

  it("残り1組になった予約で通知する", () => {
    expect(
      capacityNotice(
        { remainingGroups: 2, remainingPersons: 8 },
        { remainingGroups: 1, remainingPersons: 6 }
      )
    ).toBe("one_left");
  });

  it("すでに満席・残り1組のままなら通知しない", () => {
    expect(
      capacityNotice(
        { remainingGroups: 0, remainingPersons: 0 },
        { remainingGroups: 0, remainingPersons: 0 }
      )
    ).toBeNull();
    expect(
      capacityNotice(
        { remainingGroups: 1, remainingPersons: 6 },
        { remainingGroups: 1, remainingPersons: 4 }
      )
    ).toBeNull();
  });

  it("残り1組になると同時に満席なら満席だけ通知する", () => {
    expect(
      capacityNotice(
        { remainingGroups: 2, remainingPersons: 3 },
        { remainingGroups: 1, remainingPersons: 0 }
      )
    ).toBe("full");
  });
});

describe("外部サイトのプラン名", () => {
  it("クリスマスを含むプラン名は11,000円のクリスマスコースにする", () => {
    expect(inferChristmasCourse("【クリスマス】特別コース 11,000円")).toEqual({
      courseName: "クリスマスコース",
      coursePrice: 11000,
    });
    expect(inferChristmasCourse("Cコース")).toBeNull();
  });
});

describe("自社ページの申込検証", () => {
  const now = new Date("2026-11-20T12:00:00+09:00");
  const open = summarizeDay([], D24);

  it("正しい申込は通る", () => {
    expect(
      validateChristmasRequest({ now, date: D24, time: "18:30", persons: 2, summary: open }).ok
    ).toBe(true);
  });

  it("受付期間外・対象外の日付・時刻・人数は拒否する", () => {
    const base = { now, date: D24, time: "18:00", persons: 2, summary: open };
    expect(validateChristmasRequest({ ...base, now: new Date("2026-12-21T00:00:00+09:00") }).ok).toBe(false);
    expect(validateChristmasRequest({ ...base, date: "2026-12-23" }).ok).toBe(false);
    expect(validateChristmasRequest({ ...base, time: "20:00" }).ok).toBe(false);
    expect(validateChristmasRequest({ ...base, persons: 1 }).ok).toBe(false);
    expect(validateChristmasRequest({ ...base, persons: 5 }).ok).toBe(false);
  });

  it("満席・締切・残り人数超過は拒否する", () => {
    const base = { now, date: D24, time: "18:00", persons: 4 };
    expect(validateChristmasRequest({ ...base, summary: summarizeDay([], D24, true) }).ok).toBe(false);
    const full = summarizeDay(Array.from({ length: 6 }, () => row({ persons: 2 })), D24);
    expect(validateChristmasRequest({ ...base, summary: full }).ok).toBe(false);
    const three = summarizeDay([4, 4, 1].map((p) => row({ persons: p })), D24);
    expect(validateChristmasRequest({ ...base, summary: three }).ok).toBe(false);
    expect(validateChristmasRequest({ ...base, persons: 3, summary: three }).ok).toBe(true);
  });
});
