"use client";

import { useEffect, useRef, useState } from "react";
import ReservationDetailModal from "./ReservationDetailModal";

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const d = new Date(dateKey);
  d.setDate(d.getDate() + days);
  return formatDateKey(d);
}

function formatJP(dateKey: string) {
  const d = new Date(dateKey);
  const w = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}（${w[d.getDay()]}）`;
}

type Reservation = {
  id: string;
  name: string;
  persons: number;
  startAt: string;
  durationMinutes: number;
  seatName: string;
  status: string;
  phone?: string;
  email?: string;
  notes?: string;
};

export default function ReservationListView() {
  const [dateKey, setDateKey] = useState(formatDateKey(new Date()));
  const [items, setItems] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Reservation | null>(null);

const dateInputRef = useRef<HTMLInputElement | null>(null);

function openDatePicker() {
  const input = dateInputRef.current;
  if (!input) return;

  if (typeof input.showPicker === "function") {
    input.showPicker();
  } else {
    input.click();
  }
}


  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/steaklamp/reservations/day?date=${dateKey}`,
          { cache: "no-store" }
        );
        const data = await res.json();

        if (!alive) return;

        if (data.ok) {
          setItems(
            (data.items ?? []).map((r: any) => ({
              id: r.id,
              name: r.title ?? r.name ?? "予約",
              persons: r.persons,
              startAt: r.startAt,
              durationMinutes: r.durationMinutes,
              seatName: r.seatName,
              status: r.status,
              phone: r.phone,
              email: r.email,
              notes: r.notes,
            }))
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [dateKey]);

  function formatTime(startAt: string, duration: number) {
    const s = new Date(startAt);
    const e = new Date(s.getTime() + duration * 60000);

    const f = (d: Date) =>
      `${String(d.getHours()).padStart(2, "0")}:${String(
        d.getMinutes()
      ).padStart(2, "0")}`;

    return `${f(s)}〜${f(e)}`;
  }

  return (
    <main className="min-h-screen bg-stone-50 p-4">
      <div className="mx-auto max-w-[600px]">

        {/* ヘッダー */}
       <div className="mb-4 flex items-center justify-between">
  <div>
    <h1 className="text-xl font-bold">予約一覧</h1>
    <p className="text-xs text-stone-500">steaklamp</p>
  </div>

  <div className="flex gap-2">
    <a
      href="/steaklamp/admin/reservations"
      className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700"
    >
      台帳へ戻る
    </a>

    <button
      onClick={() => setDateKey(formatDateKey(new Date()))}
      className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700"
    >
      今日
    </button>
  </div>
</div>


        {/* 日付操作 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setDateKey(addDays(dateKey, -1))}
            className="px-3 py-2 border rounded-xl"
          >
            ←
          </button>

         <div className="relative flex-1 text-center font-semibold">
  <input
    ref={dateInputRef}
    type="date"
    value={dateKey}
    onChange={(e) => setDateKey(e.target.value)}
    className="absolute left-1/2 top-1/2 h-0 w-0 opacity-0"
  />

  <button
    type="button"
    onClick={openDatePicker}
    className="w-full rounded-xl bg-white px-3 py-2 font-semibold"
  >
    {formatJP(dateKey)}
  </button>
</div>



          <button
            onClick={() => setDateKey(addDays(dateKey, 1))}
            className="px-3 py-2 border rounded-xl"
          >
            →
          </button>
        </div>

        {/* ローディング */}
        {loading && <div className="text-sm text-gray-500">読み込み中...</div>}

        {/* リスト */}
        <div className="space-y-3">
          {items.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelected(r)}
              className="bg-white rounded-2xl p-4 shadow cursor-pointer hover:bg-stone-50"
            >
              <div className="text-sm text-gray-500">
                {formatTime(r.startAt, r.durationMinutes)}
              </div>

              <div className="text-lg font-bold mt-1">
                {r.name} 様
              </div>

              <div className="text-sm text-gray-600 mt-1">
                {r.persons}名 / {r.seatName}
              </div>

              <div className="mt-2">
                <span className="text-xs bg-green-600 text-white px-2 py-1 rounded">
                  予約完了
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 詳細モーダル */}
        {selected && (
          <ReservationDetailModal
            reservation={{
              id: selected.id,
seatId: (selected as any).seat_id ?? selected.seatId ?? "",
              title: selected.name,
              name: selected.name,
              phone: selected.phone,
              email: selected.email,
              persons: selected.persons,
              startAt: selected.startAt,
              durationMinutes: selected.durationMinutes,
              notes: selected.notes,
              seatName: selected.seatName,
            }}
            onClose={() => setSelected(null)}
            onUpdated={() => {
              setSelected(null);
              setDateKey((v) => v);
            }}
          />
        )}
      </div>
    </main>
  );
}
