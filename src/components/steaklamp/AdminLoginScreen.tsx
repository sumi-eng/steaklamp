"use client";

import { signIn, signOut } from "next-auth/react";

// 管理者ではない場合に、管理画面の代わりに表示する（予約などのデータは読み込まない）
export default function AdminLoginScreen({
  signedIn,
  email,
}: {
  signedIn: boolean;
  email: string | null;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 p-6 text-stone-900 [color-scheme:light]">
      <div className="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">Lamp 管理画面</h1>

        {signedIn ? (
          <>
            <p className="mt-3 text-sm text-stone-700">
              このアカウント{email ? `（${email}）` : ""}には、管理画面を開く権限がありません。
            </p>
            <p className="mt-2 text-xs text-stone-500">
              お店用のアカウントでログインし直してください。
            </p>
            <button
              type="button"
              onClick={() =>
                signOut({ callbackUrl: window.location.href })
              }
              className="mt-5 h-12 w-full rounded-2xl border border-stone-300 bg-white font-bold hover:bg-stone-50"
            >
              ログアウトして別のアカウントで入る
            </button>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-stone-700">
              スタッフ用のページです。ログインしてください。
            </p>
            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl: window.location.href })}
              className="mt-5 h-12 w-full rounded-2xl bg-amber-500 font-extrabold text-stone-900 hover:bg-amber-400"
            >
              Googleでログイン
            </button>
          </>
        )}
      </div>
    </main>
  );
}
