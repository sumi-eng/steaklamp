import { beforeEach, describe, expect, it, vi } from "vitest";

// 席の自由連結（reservation_seats）を扱うAPIの動作を、DBを模したモックで確認する。
// 管理者認証は log モード（既定）なので通る。拒否のテストは admin-guard.test.ts にある。

vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/steaklamp/lib/lineNotify", () => ({
  sendLineReservationNotice: vi.fn(async () => undefined),
  sendLineText: vi.fn(async () => undefined),
}));

type Row = Record<string, any>;

const db = vi.hoisted(() => ({
  existing: null as Row | null,
  seats: [] as Row[],
  members: [] as Row[],
  reservations: [] as Row[], // 同じ時間帯の窓にある他の予約
  links: [] as Row[], // reservation_seats の行 { reservation_id, seat_id }
  rpcCalls: [] as Array<{ name: string; args: any }>,
  updates: [] as Row[],
  inserts: [] as Row[],
  deletedSeatIds: [] as string[],
  deleteError: null as null | { code?: string; message: string },
  reservationsUsingSeat: 0,
  membersUsingSeat: 0,
}));

vi.mock("@/steaklamp/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: any) => {
      db.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from(table: string) {
      let op = "select";
      let payload: Row = {};
      let head = false;
      const filters: Array<[string, any]> = [];

      const resolve = (single: boolean) => {
        if (table === "stores") return { data: { id: "store-1", code: "steaklamp" }, error: null };
        if (table === "store_closures") return { data: null, error: null };
        if (table === "seats") {
          if (op === "delete") {
            const sid = filters.find(([c]) => c === "id")?.[1];
            if (!db.deleteError) db.deletedSeatIds.push(sid);
            return { data: null, error: db.deleteError };
          }
          return { data: db.seats, error: null };
        }
        if (table === "seat_members") {
          if (head) return { data: null, count: db.membersUsingSeat, error: null };
          return { data: db.members, error: null };
        }
        if (table === "reservation_seats") {
          const seatFilter = filters.find(([c]) => c === "seat_id");
          if (head && seatFilter) {
            return { data: null, count: db.links.filter((l) => l.seat_id === seatFilter[1]).length, error: null };
          }
          const idFilter = filters.find(([c]) => c === "reservation_id");
          const wanted: string[] = idFilter?.[1] ?? [];
          return { data: db.links.filter((l) => wanted.includes(l.reservation_id)), error: null };
        }
        if (table === "reservations") {
          if (op === "update") return { data: { ...db.existing, ...payload }, error: null };
          if (op === "insert") return { data: { id: "new-1", ...payload }, error: null };
          if (head) return { data: null, count: db.reservationsUsingSeat, error: null };
          if (single) return { data: db.existing, error: null };
          return { data: db.reservations, error: null };
        }
        return { data: null, error: null };
      };

      const b: any = {
        select: (_cols?: string, opts?: { head?: boolean }) => {
          if (opts?.head) head = true;
          return b;
        },
        eq: (col: string, val: any) => (filters.push([col, val]), b),
        in: (col: string, val: any) => (filters.push([col, val]), b),
        or: () => b,
        gte: () => b,
        lte: () => b,
        order: () => b,
        update: (p: Row) => ((op = "update"), (payload = p), db.updates.push(p), b),
        insert: (p: Row) => ((op = "insert"), (payload = p), db.inserts.push(p), b),
        delete: () => ((op = "delete"), b),
        single: () => Promise.resolve(resolve(true)),
        maybeSingle: () => Promise.resolve(resolve(true)),
        then: (ok: any, ng: any) => Promise.resolve(resolve(false)).then(ok, ng),
      };
      return b;
    },
  },
}));

import { POST as updatePost } from "../../../../app/api/steaklamp/reservations/update/route";
import { POST as createPost } from "../../../../app/api/steaklamp/reservations/create/route";
import { DELETE as seatDelete } from "../../../../app/api/steaklamp/admin/seats/route";
import { loadSeatLinks, replaceSeatLinks } from "../reservationSeats";

const DEFS: [string, number, number][] = [
  ["T1-1", 1, 2], ["T1-2", 1, 2], ["T2-1", 1, 2], ["T2-2", 1, 2], ["T3-1", 1, 2], ["T3-2", 1, 2],
  ["C1", 1, 1], ["C2", 1, 1], ["C3", 1, 1], ["C4", 1, 1],
  ["右テーブル", 2, 4],
];
const id = (name: string) => `seat-${name}`;
const START = "2026-12-01T19:00:00+09:00";

function req(url: string, body: unknown, method = "POST") {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function updateBody(over: Row = {}) {
  return {
    id: "r1",
    name: "山田",
    persons: 4,
    startAt: START,
    durationMinutes: 120,
    seatIds: [id("T1-1")],
    ...over,
  };
}

function other(rid: string, seat: string): Row {
  return { id: rid, name: `${rid}様`, seat_id: id(seat), start_at: new Date(START).toISOString(), duration_minutes: 120, status: "booked" };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.ADMIN_AUTH_MODE;
  db.existing = {
    id: "r1",
    store_id: "store-1",
    seat_id: id("T1-1"),
    persons: 4,
    start_at: new Date(START).toISOString(),
    duration_minutes: 120,
    assignment_status: "assigned",
    course_name_snapshot: null,
  };
  db.seats = DEFS.map(([name, min, max], i) => ({
    id: id(name), name, min_persons: min, max_persons: max, is_active: true, is_reservable: true, sort_order: i + 1,
  }));
  db.members = [
    { group_seat_id: id("右テーブル"), member_seat_id: id("T1-1") },
    { group_seat_id: id("右テーブル"), member_seat_id: id("T1-2") },
  ];
  db.reservations = [];
  db.links = [];
  db.rpcCalls = [];
  db.updates = [];
  db.inserts = [];
  db.deletedSeatIds = [];
  db.deleteError = null;
  db.reservationsUsingSeat = 0;
  db.membersUsingSeat = 0;
});

const replaceCalls = () => db.rpcCalls.filter((c) => c.name === "replace_reservation_seats");

describe("reservationSeats：連結の読み書き", () => {
  it("replaceSeatLinks：2席以上はそのまま、1席以下は空にして渡す（古い連結を残さない）", async () => {
    await replaceSeatLinks("r1", ["a", "b", "c"]);
    await replaceSeatLinks("r1", ["a"]);
    await replaceSeatLinks("r1", []);
    expect(replaceCalls().map((c) => c.args)).toEqual([
      { p_reservation_id: "r1", p_seat_ids: ["a", "b", "c"] },
      { p_reservation_id: "r1", p_seat_ids: [] },
      { p_reservation_id: "r1", p_seat_ids: [] },
    ]);
  });

  it("loadSeatLinks：予約ごとに席IDをまとめる。連結のない予約はキーなし", async () => {
    db.links = [
      { reservation_id: "r1", seat_id: "a" },
      { reservation_id: "r1", seat_id: "b" },
    ];
    const map = await loadSeatLinks(["r1", "r2", null, undefined]);
    expect(map.get("r1")).toEqual(["a", "b"]);
    expect(map.has("r2")).toBe(false);
  });
});

describe("reservations/update：連結の保存と掃除", () => {
  it("連結した予約を1席に戻すと、連結の行を消す（席が埋まったままにならない）", async () => {
    db.links = [
      { reservation_id: "r1", seat_id: id("T1-1") },
      { reservation_id: "r1", seat_id: id("T2-1") },
    ];
    const res = await updatePost(req("/api/steaklamp/reservations/update", updateBody({ persons: 2, seatIds: [id("T1-1")] })));
    expect(res.status).toBe(200);
    expect(db.updates[0].seat_id).toBe(id("T1-1"));
    expect(replaceCalls().map((c) => c.args)).toEqual([{ p_reservation_id: "r1", p_seat_ids: [] }]);
  });

  it("連結した予約をグループ席（右テーブル）に選び直すと、連結の行を消す", async () => {
    db.links = [
      { reservation_id: "r1", seat_id: id("T1-1") },
      { reservation_id: "r1", seat_id: id("C3") },
    ];
    const res = await updatePost(req("/api/steaklamp/reservations/update", updateBody({ seatIds: [id("右テーブル")] })));
    expect(res.status).toBe(200);
    expect(db.updates[0].seat_id).toBe(id("右テーブル"));
    expect(replaceCalls().map((c) => c.args)).toEqual([{ p_reservation_id: "r1", p_seat_ids: [] }]);
  });

  it("従来の seatId だけの呼び出しでも、1席として保存できる", async () => {
    const res = await updatePost(
      req("/api/steaklamp/reservations/update", { ...updateBody({ persons: 2, seatIds: undefined }), seatId: id("T2-1") })
    );
    expect(res.status).toBe(200);
    expect(db.updates[0].seat_id).toBe(id("T2-1"));
  });

  it("1席の予約を連結にすると、先頭の席が代表席（seat_id）になり、連結の行を保存する", async () => {
    const seatIds = [id("T2-1"), id("T3-1"), id("C3")];
    const res = await updatePost(req("/api/steaklamp/reservations/update", updateBody({ seatIds })));
    expect(res.status).toBe(200);
    expect(db.updates[0].seat_id).toBe(id("T2-1"));
    expect(replaceCalls().map((c) => c.args)).toEqual([{ p_reservation_id: "r1", p_seat_ids: seatIds }]);
  });

  it("連結のうち1席でも同じ時間帯の他の予約と重なれば、409で保存できない", async () => {
    db.reservations = [other("o1", "C3")];
    const res = await updatePost(
      req("/api/steaklamp/reservations/update", updateBody({ seatIds: [id("T2-1"), id("T3-1"), id("C3")] }))
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("seat_conflict");
    expect(db.updates).toHaveLength(0);
    expect(replaceCalls()).toHaveLength(0);
  });

  it("他の予約が連結していて、その連結先の席を選ぶときも409", async () => {
    db.reservations = [other("o1", "T1-1")];
    db.links = [
      { reservation_id: "o1", seat_id: id("T1-1") },
      { reservation_id: "o1", seat_id: id("T3-1") },
    ];
    db.existing = { ...db.existing!, seat_id: id("T2-1") };
    const res = await updatePost(
      req("/api/steaklamp/reservations/update", updateBody({ seatIds: [id("T3-1")] }))
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("seat_conflict");
  });

  it("自分自身の連結は、席の選び直しで重なりとして数えない", async () => {
    db.reservations = [other("r1", "T1-1")];
    db.links = [
      { reservation_id: "r1", seat_id: id("T1-1") },
      { reservation_id: "r1", seat_id: id("T2-1") },
    ];
    const res = await updatePost(
      req("/api/steaklamp/reservations/update", updateBody({ seatIds: [id("T2-1"), id("T1-1")] }))
    );
    expect(res.status).toBe(200);
  });

  it("席が足りない・取りすぎは確認が必要。確認すれば保存できる", async () => {
    // 2名に T1-1+T1-2+T2-1+T2-2+T3-1+T3-2 = 12名分 → 取りすぎ
    const seatIds = ["T1-1", "T1-2", "T2-1", "T2-2", "T3-1", "T3-2"].map(id);
    const body = updateBody({ persons: 2, seatIds });
    db.existing = { ...db.existing!, persons: 2 };

    const first = await updatePost(req("/api/steaklamp/reservations/update", body));
    expect(first.status).toBe(409);
    const data = await first.json();
    expect(data.error).toBe("persons_out_of_range");
    expect(data.detail).toContain("多すぎ");
    expect(db.updates).toHaveLength(0);

    const second = await updatePost(
      req("/api/steaklamp/reservations/update", { ...body, confirmCapacityMismatch: true })
    );
    expect(second.status).toBe(200);
    expect(replaceCalls()).toHaveLength(1);
  });

  it("席が足りないときも確認が必要", async () => {
    db.existing = { ...db.existing!, persons: 9 };
    const res = await updatePost(
      req("/api/steaklamp/reservations/update", updateBody({ persons: 9, seatIds: [id("T2-1"), id("T3-1")] }))
    );
    expect(res.status).toBe(409);
    expect((await res.json()).detail).toContain("席が足りません");
  });

  it("席・日時・人数が変わらない編集（備考など）では、連結を触らない", async () => {
    db.links = [
      { reservation_id: "r1", seat_id: id("T1-1") },
      { reservation_id: "r1", seat_id: id("T2-1") },
    ];
    // 他の予約と重なる状況でも、席を変えない編集は止めない
    db.reservations = [other("o1", "T2-1")];
    const res = await updatePost(
      req("/api/steaklamp/reservations/update", {
        ...updateBody({ seatIds: [id("T1-1"), id("T2-1")] }),
        notes: "窓際希望",
      })
    );
    expect(res.status).toBe(200);
    expect(replaceCalls()).toHaveLength(0);
  });

  it("代表席が連結に含まれない古い行が残っていたら、保存のときに掃除する", async () => {
    db.links = [
      { reservation_id: "r1", seat_id: id("T2-1") },
      { reservation_id: "r1", seat_id: id("T2-2") },
    ];
    const res = await updatePost(
      req("/api/steaklamp/reservations/update", { ...updateBody({ seatIds: [id("T1-1")] }), notes: "x" })
    );
    expect(res.status).toBe(200);
    expect(replaceCalls().map((c) => c.args)).toEqual([{ p_reservation_id: "r1", p_seat_ids: [] }]);
  });

  it("存在しない席・無効な席が混ざっていたら404", async () => {
    const res = await updatePost(
      req("/api/steaklamp/reservations/update", updateBody({ seatIds: [id("T2-1"), "seat-unknown"] }))
    );
    expect(res.status).toBe(404);
    expect(db.updates).toHaveLength(0);
  });
});

describe("reservations/create：スタッフの連結", () => {
  const createBody = (over: Row = {}) => ({
    source: "admin",
    name: "電話の方",
    phone: "09012345678",
    persons: 4,
    startAt: "2026-12-01T19:00",
    duration: 120,
    seatIds: [id("T2-1"), id("T3-1"), id("C3")],
    ...over,
  });

  it("連結の席で登録でき、先頭が代表席、連結の行を保存する", async () => {
    const res = await createPost(req("/api/steaklamp/reservations/create", createBody()));
    expect(res.status).toBe(200);
    expect(db.inserts[0].seat_id).toBe(id("T2-1"));
    expect(replaceCalls().map((c) => c.args)).toEqual([
      { p_reservation_id: "new-1", p_seat_ids: [id("T2-1"), id("T3-1"), id("C3")] },
    ]);
  });

  it("選んだ席のどれか1つでも他の予約と重なれば登録しない", async () => {
    db.reservations = [other("o1", "C3")];
    const res = await createPost(req("/api/steaklamp/reservations/create", createBody()));
    expect(res.status).toBe(400);
    expect(db.inserts).toHaveLength(0);
  });

  it("席の取りすぎは確認が必要。確認すれば登録できる", async () => {
    const seatIds = ["T1-1", "T1-2", "T2-1", "T2-2", "T3-1", "T3-2"].map(id);
    const first = await createPost(req("/api/steaklamp/reservations/create", createBody({ persons: 2, seatIds })));
    expect(first.status).toBe(409);
    expect((await first.json()).error).toBe("persons_out_of_range");
    expect(db.inserts).toHaveLength(0);

    const second = await createPost(
      req("/api/steaklamp/reservations/create", createBody({ persons: 2, seatIds, confirmCapacityMismatch: true }))
    );
    expect(second.status).toBe(200);
  });

  it("お客様の予約ページ（source:admin でない）からの連結は受け付けない", async () => {
    const res = await createPost(req("/api/steaklamp/reservations/create", createBody({ source: "web" })));
    expect(res.status).toBe(403);
    expect(db.inserts).toHaveLength(0);
  });

  it("1席だけの登録は従来どおり（連結の行を作らない）", async () => {
    const res = await createPost(
      req("/api/steaklamp/reservations/create", createBody({ seatIds: undefined, seatId: id("右テーブル") }))
    );
    expect(res.status).toBe(200);
    expect(db.inserts[0].seat_id).toBe(id("右テーブル"));
    expect(replaceCalls()).toHaveLength(0);
  });
});

describe("admin/seats DELETE：連結に使われている席は削除できない", () => {
  const del = (body: unknown) => seatDelete(req("/api/steaklamp/admin/seats", body, "DELETE"));
  const UUID = "11111111-2222-3333-4444-555555555555";

  it("予約の連結に使われていれば409（削除しない）", async () => {
    db.links = [{ reservation_id: "r1", seat_id: UUID }];
    const res = await del({ id: UUID });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("seat_in_use_by_linked_reservations");
    expect(data.detail).toContain("席の連結");
    expect(db.deletedSeatIds).toEqual([]);
  });

  it("予約の代表席に使われていれば409", async () => {
    db.reservationsUsingSeat = 2;
    const res = await del({ id: UUID });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("seat_in_use_by_reservations");
    expect(db.deletedSeatIds).toEqual([]);
  });

  it("グループ席の構成に使われていれば409", async () => {
    db.membersUsingSeat = 1;
    const res = await del({ id: UUID });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("seat_in_use_by_groups");
  });

  it("どこにも使われていなければ削除できる", async () => {
    const res = await del({ id: UUID });
    expect(res.status).toBe(200);
    expect(db.deletedSeatIds).toEqual([UUID]);
  });

  it("DBの外部キー違反（確認後に使われた場合）もわかりやすい409にする", async () => {
    db.deleteError = { code: "23503", message: "violates foreign key constraint" };
    const res = await del({ id: UUID });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("seat_in_use");
  });

  it("IDが不正なら400", async () => {
    expect((await del({ id: "abc,group_seat_id.eq.x" })).status).toBe(400);
    expect((await del({})).status).toBe(400);
  });
});
