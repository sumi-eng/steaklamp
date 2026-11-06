import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ログイン状態をテストごとに差し替える
let sessionUser: { email?: string; provider?: string } | null = null;
vi.mock("@/auth", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

// DBは「呼ばれたら記録して失敗」にして、拒否時にDBへ触れていないことを確認する
const dbCalls: string[] = [];
vi.mock("@/steaklamp/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from(table: string) {
      dbCalls.push(table);
      throw new Error("db should not be called in this test");
    },
  },
}));
vi.mock("@/steaklamp/lib/lineNotify", () => ({
  sendLineReservationNotice: vi.fn(),
  sendLineText: vi.fn(),
}));

import { requireAdmin } from "../adminAuth";
import { POST as deletePost } from "../../../../app/api/steaklamp/reservations/delete/route";
import { GET as dayGet } from "../../../../app/api/steaklamp/reservations/day/route";
import { POST as closuresPost } from "../../../../app/api/steaklamp/closures/route";
import { POST as createPost } from "../../../../app/api/steaklamp/reservations/create/route";
import { POST as seatsSearchPost } from "../../../../app/api/steaklamp/seats/search/route";
import { GET as seatsAdminGet, DELETE as seatsAdminDelete } from "../../../../app/api/steaklamp/admin/seats/route";
import { POST as updatePost } from "../../../../app/api/steaklamp/reservations/update/route";

const OWNER = { email: "owner@example.com", provider: "google" };

function post(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sessionUser = null;
  dbCalls.length = 0;
  process.env.STEAKLAMP_ADMIN_EMAILS = "owner@example.com";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.ADMIN_AUTH_MODE;
  vi.restoreAllMocks();
});

describe("requireAdmin", () => {
  it("enforce：未ログインは401、お客様のGoogleログインは403、許可リストの管理者は通す", async () => {
    process.env.ADMIN_AUTH_MODE = "enforce";

    expect((await requireAdmin("t"))?.status).toBe(401);

    sessionUser = { email: "customer@example.com", provider: "google" };
    expect((await requireAdmin("t"))?.status).toBe(403);

    sessionUser = { email: "owner@example.com", provider: "line" };
    expect((await requireAdmin("t"))?.status).toBe(403);

    sessionUser = OWNER;
    expect(await requireAdmin("t")).toBeNull();
  });

  it("log（既定）：拒否せず、拒否されるはずのアクセスをログに残す", async () => {
    expect(await requireAdmin("reservations/day")).toBeNull();
    const logged = (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(logged).toContain("STEAKLAMP_ADMIN_AUTH_WOULD_DENY route=reservations/day");
  });

  it("未使用候補のAPIは、呼ばれたこと自体を記録する", async () => {
    sessionUser = OWNER;
    await requireAdmin("availability(POST)", { unusedCandidate: true });
    const logged = (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(logged).toContain("STEAKLAMP_UNUSED_ROUTE_CALLED route=availability(POST)");
  });
});

describe("enforce：未ログインで管理用APIを呼ぶと拒否され、DBに触れない", () => {
  beforeEach(() => {
    process.env.ADMIN_AUTH_MODE = "enforce";
  });

  it("予約の個人情報を返す day", async () => {
    const res = await dayGet(new Request("http://localhost/api?date=2026-12-24"));
    expect(res.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it("予約の削除", async () => {
    const res = await deletePost(post({ id: "x" }));
    expect(res.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it("休業日の追加", async () => {
    const res = await closuresPost(post({ closed_on: "2026-12-24" }));
    expect(res.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it("席の設定", async () => {
    const res = await seatsAdminGet();
    expect(res.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it("席の削除（連結に使われている席の削除チェックを含む）", async () => {
    const res = await seatsAdminDelete(
      new Request("http://localhost/api", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "11111111-2222-3333-4444-555555555555" }),
      })
    );
    expect(res.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it("席を連結する予約の変更", async () => {
    const res = await updatePost(post({ id: "r1", seatIds: ["a", "b"] }));
    expect(res.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it("source:admin で席を連結した予約作成", async () => {
    const res = await createPost(
      post({
        source: "admin",
        name: "テスト",
        phone: "09012345678",
        persons: 4,
        startAt: "2020-01-01T18:00",
        seatIds: ["s1", "s2"],
      })
    );
    expect(res.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it("お客様の予約ページから席の連結を指定しても、DBに触れる前に拒否される（enforceでなくても）", async () => {
    const res = await createPost(
      post({
        name: "お客様",
        phone: "09012345678",
        persons: 4,
        startAt: "2099-01-01T18:00",
        seatIds: ["s1", "s2"],
      })
    );
    expect(res.status).toBe(403);
    expect(dbCalls).toEqual([]);
  });

  it("source:admin を名乗った予約作成（受付期限を省略できる経路）", async () => {
    const res = await createPost(
      post({
        source: "admin",
        name: "テスト",
        phone: "09012345678",
        persons: 2,
        startAt: "2020-01-01T18:00",
        seatId: "s1",
      })
    );
    expect(res.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it("席検索の includeAll / excludeReservationId は管理者だけ", async () => {
    const a = await seatsSearchPost(
      post({ persons: 2, startAt: "2026-12-24T18:00", includeAll: true })
    );
    expect(a.status).toBe(401);
    const b = await seatsSearchPost(
      post({ persons: 2, startAt: "2026-12-24T18:00", excludeReservationId: "r1" })
    );
    expect(b.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it("source を名乗らないお客様の予約作成は、認証チェックで止まらない（受付期限など通常の検証へ進む）", async () => {
    const res = await createPost(
      post({
        name: "お客様",
        phone: "09012345678",
        persons: 2,
        startAt: "2020-01-01T18:00",
        seatId: "s1",
      })
    );
    // 過去日時として通常の検証で拒否される（401/403 ではない）
    expect(res.status).toBe(400);
  });

  it("管理者としてログインしていれば通る", async () => {
    sessionUser = OWNER;
    // 認証を通過してDB（モック）に進み、モックが例外を投げて500になる＝認証では止まっていない
    const res = await deletePost(post({ id: "x" }));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(dbCalls.length).toBeGreaterThan(0);
  });
});

describe("log モード：従来どおり動く（切り替え前に台帳が止まらない）", () => {
  it("未ログインでも拒否しない", async () => {
    const res = await deletePost(post({ id: "x" }));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
