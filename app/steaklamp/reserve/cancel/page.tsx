"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const SHOP_PHONE = "088-655-8623";

function ReserveCancelPageInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleCancel() {
    if (!token) {
      setMessage("キャンセル情報が見つかりません。");
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/steaklamp/reservations/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const json = await res.json().catch(() => ({} as any));

      if (!res.ok || !json?.ok) {
        setMessage(json?.error ?? "キャンセルに失敗しました。");
        return;
      }

      if (json.alreadyCancelled) {
        setMessage("このご予約はすでにキャンセルされています。");
        setDone(true);
        return;
      }

      setDone(true);
      setMessage("ご予約をキャンセルしました。");
    } catch (e: any) {
      setMessage(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-10 text-stone-900">
      <div className="mx-auto max-w-lg overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-100 px-6 py-6">
          <div className="text-2xl font-extrabold tracking-tight">
            ご予約キャンセル
          </div>
          <div className="mt-2 text-sm text-stone-500">Steak Lamp</div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
            Webからのキャンセルは2日前まで承っております。
            前日・当日の変更やキャンセルはお電話にてお願いいたします。
            <div className="mt-2 font-bold">TEL: {SHOP_PHONE}</div>
          </div>

          {message ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {message}
            </div>
          ) : null}

          {!done ? (
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="h-12 w-full rounded-2xl bg-amber-500 font-extrabold text-stone-900 shadow-sm hover:bg-amber-400 disabled:bg-stone-300 disabled:text-stone-500"
            >
              {loading ? "処理中..." : "予約をキャンセルする"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ReserveCancelPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-50 px-4 py-10 text-stone-900">
          <div className="mx-auto max-w-lg overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
            <div className="border-b border-stone-100 px-6 py-6">
              <div className="text-2xl font-extrabold tracking-tight">
                ご予約キャンセル
              </div>
              <div className="mt-2 text-sm text-stone-500">Steak Lamp</div>
            </div>
            <div className="px-6 py-6 text-sm text-stone-500">読み込み中...</div>
          </div>
        </div>
      }
    >
      <ReserveCancelPageInner />
    </Suspense>
  );
}
