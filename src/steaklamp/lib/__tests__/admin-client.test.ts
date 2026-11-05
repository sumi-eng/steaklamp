import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_AUTH_EVENT, adminFetch, type AdminAuthEventDetail } from "../adminClient";

describe("adminFetch", () => {
  const events: AdminAuthEventDetail[] = [];
  let target: EventTarget;

  beforeEach(() => {
    events.length = 0;
    target = new EventTarget();
    target.addEventListener(ADMIN_AUTH_EVENT, (e) => {
      events.push((e as CustomEvent<AdminAuthEventDetail>).detail);
    });
    vi.stubGlobal("window", target);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockStatus(status: number) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
  }

  it("401（ログイン切れ）を通知し、レスポンスはそのまま返す", async () => {
    mockStatus(401);
    const res = await adminFetch("/api/steaklamp/reservations/day?date=2026-12-24");
    expect(res.status).toBe(401);
    expect(events).toEqual([{ status: 401 }]);
  });

  it("403（権限なし）を通知する", async () => {
    mockStatus(403);
    await adminFetch("/api/steaklamp/reservations/update", { method: "POST" });
    expect(events).toEqual([{ status: 403 }]);
  });

  it("正常なレスポンスや他のエラーでは通知しない", async () => {
    mockStatus(200);
    await adminFetch("/api/steaklamp/reservations/day");
    mockStatus(500);
    await adminFetch("/api/steaklamp/reservations/day");
    expect(events).toEqual([]);
  });
});
