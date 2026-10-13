import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 画面を開いたままデプロイされたとき、前面に戻った際に自動で再読み込みされることの確認。
// 画面側のビルド識別子(NEXT_PUBLIC_BUILD_ID)は読み込み時に固定されるため、テストごとにモジュールを読み直す。
async function load(clientBuildId: string | undefined) {
  vi.resetModules();
  if (clientBuildId === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID;
  else process.env.NEXT_PUBLIC_BUILD_ID = clientBuildId;
  return (await import("./useForegroundRefresh")).reloadIfNewVersion;
}

describe("reloadIfNewVersion", () => {
  const reload = vi.fn();
  const store = new Map<string, string>();

  beforeEach(() => {
    reload.mockReset();
    store.clear();
    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const serverReturns = (buildId: string | null, ok = true) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok, json: async () => ({ buildId }) }))
    );

  it("サーバーのバージョンが同じなら再読み込みしない", async () => {
    const fn = await load("abc");
    serverReturns("abc");
    expect(await fn()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("新しいバージョンがデプロイされていたら再読み込みする", async () => {
    const fn = await load("abc");
    serverReturns("def");
    expect(await fn()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("直近に再読み込みしていたら、繰り返さない（配信の切り替わり中のループ防止）", async () => {
    const fn = await load("abc");
    serverReturns("def");
    expect(await fn()).toBe(true);
    expect(await fn()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("1分以上たてば、再び再読み込みできる", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const fn = await load("abc");
    serverReturns("def");
    await fn();
    vi.setSystemTime(new Date("2026-10-14T10:02:00Z"));
    expect(await fn()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("バージョン確認に失敗しても何もしない（更新の失敗で画面を壊さない）", async () => {
    const fn = await load("abc");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fn()).toBe(false);
    serverReturns("def", false);
    expect(await fn()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("サーバーがバージョンを返さない・画面側に識別子が無いときは何もしない", async () => {
    const fn = await load("abc");
    serverReturns(null);
    expect(await fn()).toBe(false);

    const fn2 = await load(undefined);
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await fn2()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
