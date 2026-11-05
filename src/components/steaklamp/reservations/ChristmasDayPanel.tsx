"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { CHRISTMAS, jstDateKey } from "@/steaklamp/lib/christmas";

type Day = {
  date: string;
  label: string;
  usedGroups: number;
  usedPersons: number;
  remainingGroups: number;
  remainingPersons: number;
  closed: boolean;
  full: boolean;
};

// 予約台帳の上部に出す、クリスマスコース（12/24・25）の残り枠と手動締切
export default function ChristmasDayPanel({
  reloadTick,
  currentDateKey,
  onSelectDate,
}: {
  reloadTick: number;
  currentDateKey: string;
  onSelectDate: (dateKey: string) => void;
}) {
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/steaklamp/christmas/days", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setDays(json.days as Day[]);
        setSignedIn(Boolean(json.signedIn));
        setCanEdit(Boolean(json.canEdit));
        setError(null);
      } else {
        setError("クリスマスの残り枠を取得できませんでした");
      }
    } catch {
      setError("クリスマスの残り枠を取得できませんでした");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadTick]);

  async function toggleClosed(day: Day) {
    const next = !day.closed;
    const ok = window.confirm(
      next
        ? `${day.label}のWeb受付を締め切ります。よろしいですか？（外部サイトの受付は止まりません）`
        : `${day.label}のWeb受付を再開します。よろしいですか？`
    );
    if (!ok) return;

    setBusyDate(day.date);
    try {
      const res = await fetch("/api/steaklamp/christmas/days", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: day.date, is_closed: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        window.alert("この操作には管理者としてのログインが必要です。");
      } else if (!res.ok || !json.ok) {
        window.alert("受付の切り替えに失敗しました。もう一度お試しください。");
      }
    } catch {
      window.alert("受付の切り替えに失敗しました。もう一度お試しください。");
    } finally {
      setBusyDate(null);
      load();
    }
  }

  // 対象日を過ぎたら表示しない
  const lastDate = CHRISTMAS.dates[CHRISTMAS.dates.length - 1];
  if (jstDateKey(new Date()) > lastDate) return null;

  return (
    <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3">
      <div className="mb-2 flex items-center justify-between text-sm font-extrabold text-rose-800">
        <span>🎄 クリスマスコース 残り枠（各日 上限{CHRISTMAS.maxGroups}組・{CHRISTMAS.maxPersons}名）</span>
        {error ? <span className="text-xs font-normal text-red-600">{error}</span> : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(days ?? []).map((d) => (
          <div
            key={d.date}
            className={[
              "rounded-xl border bg-white p-3",
              d.date === currentDateKey ? "border-rose-400" : "border-stone-200",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onSelectDate(d.date)}
                className="text-left text-base font-extrabold text-stone-900 underline-offset-2 hover:underline"
              >
                {d.label}
              </button>
              {d.full ? (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-extrabold text-white">
                  {d.closed && d.remainingGroups > 0 && d.remainingPersons > 0
                    ? "手動で締切"
                    : "満席"}
                </span>
              ) : (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-extrabold text-emerald-800">
                  受付中
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-stone-800">
              予約 <b>{d.usedGroups}組・{d.usedPersons}名</b>
              <span className="mx-1 text-stone-400">／</span>
              残り <b>{d.remainingGroups}組・{d.remainingPersons}名</b>
            </div>
            {canEdit ? (
              <button
                type="button"
                disabled={busyDate === d.date}
                onClick={() => toggleClosed(d)}
                className="mt-2 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
              >
                {d.closed ? "Web受付を再開する" : "Web受付を締め切る"}
              </button>
            ) : null}
          </div>
        ))}
        {!days && !error ? <div className="text-sm text-stone-500">読み込み中...</div> : null}
      </div>

      {days && !canEdit ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-600">
          {signedIn ? (
            <>
              <span>このアカウントには受付を締め切る権限がありません。</span>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: window.location.href })}
                className="rounded-lg border border-stone-300 bg-white px-2 py-1 font-bold"
              >
                ログアウト
              </button>
            </>
          ) : (
            <>
              <span>受付の締切・再開は、管理者ログインが必要です。</span>
              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl: window.location.href })}
                className="rounded-lg border border-stone-300 bg-white px-2 py-1 font-bold"
              >
                管理者ログイン（Google）
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
