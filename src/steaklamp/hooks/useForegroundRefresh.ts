"use client";

import { useEffect, useRef } from "react";

// ビルドごとに変わる識別子（next.config.ts で埋め込み）。サーバー側の /api/steaklamp/version と比べて、
// 画面を開いたままデプロイされたかどうかを判定する。
const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID;

const RELOAD_GUARD_KEY = "steaklamp:version-reload-at";
const RELOAD_GUARD_MS = 60_000;
const FOREGROUND_THROTTLE_MS = 2_000;

// 新しいバージョンがデプロイされていたら画面を再読み込みする。再読み込みしたら true。
// ホーム画面に追加したアプリは、閉じるまで古い画面・古いJavaScriptを使い続けるため。
export async function reloadIfNewVersion() {
  if (!CLIENT_BUILD_ID) return false;

  try {
    const res = await fetch("/api/steaklamp/version", { cache: "no-store" });
    if (!res.ok) return false;

    const data = (await res.json()) as { buildId?: string };
    if (!data.buildId || data.buildId === CLIENT_BUILD_ID) return false;

    // 配信の切り替わり中などで再読み込みを繰り返さないよう、直近に再読み込みしていたらやめる
    try {
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
      if (Date.now() - last < RELOAD_GUARD_MS) return false;
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch {
      // sessionStorage が使えない環境では、ガード無しで再読み込みする
    }

    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

// アプリがバックグラウンドから前面に戻ったとき（visibilitychange / bfcacheからの復帰）に、
// 新しいバージョンの確認と、渡された更新処理を行う。
export function useForegroundRefresh(onRefresh: () => void) {
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let last = 0;

    function handle() {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - last < FOREGROUND_THROTTLE_MS) return;
      last = now;

      void reloadIfNewVersion();
      refreshRef.current();
    }

    function handlePageShow(e: PageTransitionEvent) {
      if (e.persisted) handle();
    }

    document.addEventListener("visibilitychange", handle);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handle);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);
}
