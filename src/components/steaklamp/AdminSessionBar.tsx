"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import {
  ADMIN_AUTH_EVENT,
  type AdminAuthEventDetail,
} from "@/steaklamp/lib/adminClient";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// 管理画面の上部：ログイン中のアカウントとログアウト。
// ログインが切れたら、表示中の内容や入力途中のモーダルはそのままに、再ログインの案内を重ねる。
export default function AdminSessionBar({ email }: { email: string | null }) {
  const [problem, setProblem] = useState<401 | 403 | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/steaklamp/admin/session", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!json?.ok) return;
      if (json.enforce && !json.isAdmin) setProblem(json.signedIn ? 403 : 401);
      else setProblem(null);
    } catch {
      // 通信できないだけではログイン切れと断定しない
    }
  }, []);

  useEffect(() => {
    const onAuth = (e: Event) => {
      const status = (e as CustomEvent<AdminAuthEventDetail>).detail?.status;
      setProblem(status === 403 ? 403 : 401);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    window.addEventListener(ADMIN_AUTH_EVENT, onAuth);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener(ADMIN_AUTH_EVENT, onAuth);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, [check]);

  return (
    <>
      {problem ? (
        <div className="sticky top-0 z-[100] border-b border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 shadow">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2">
            <span className="font-bold">
              {problem === 401
                ? "ログインの有効期限が切れました。表示中の内容はそのままです。再ログインしてください。"
                : "このアカウントには操作の権限がありません。"}
            </span>
            {problem === 401 ? (
              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl: window.location.href })}
                className="rounded-xl bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-700"
              >
                再ログイン
              </button>
            ) : (
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: window.location.href })}
                className="rounded-xl border border-red-300 bg-white px-4 py-2 font-bold"
              >
                ログアウト
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3 bg-stone-100 px-4 py-1 text-xs text-stone-600">
        {email ? (
          <>
            <span>ログイン中：{email}</span>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: window.location.href })}
              className="rounded-lg border border-stone-300 bg-white px-2 py-0.5 font-bold"
            >
              ログアウト
            </button>
          </>
        ) : (
          <>
            <span>未ログイン</span>
            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl: window.location.href })}
              className="rounded-lg border border-stone-300 bg-white px-2 py-0.5 font-bold"
            >
              管理者ログイン
            </button>
          </>
        )}
      </div>
    </>
  );
}
