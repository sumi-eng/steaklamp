"use client";

import { useEffect, useState } from "react";
import ReservationDetailModal from "./ReservationDetailModal";

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(dateKey: string, days: number) {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + days);
  return formatDateKey(d);
}

function formatJP(dateKey: string) {
  const d = parseDateKey(dateKey);
  const w = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}（${w[d.getDay()]}）`;
}

function formatMonthKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function buildCalendarDays(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

type Reservation = {
  id: string;
  seatId: string;
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

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    parseDateKey(formatDateKey(new Date()))
  );
  const [calendarMeta, setCalendarMeta] = useState<Record<string, any>>({});

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
              seatId: r.seatId ?? r.seat_id ?? "",
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
        } else {
          setItems([]);
        }
      } catch {
        if (alive) setItems([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [dateKey]);

  useEffect(() => {
    if (!isCalendarOpen) return;

    let alive = true;

    async function loadCalendarMeta() {
      const month = formatMonthKey(calendarMonth);

      try {
        const res = await fetch(`/api/steaklamp/calendar-meta?month=${month}`, {
          cache: "no-store",
        });

        const data = await res.json();

        if (!alive) return;

        const rawDays =
          data.days ??
          data.items ??
          data.calendar ??
          data.dates ??
          data.reservations ??
          {};

        const map: Record<string, any> = {};

        if (Array.isArray(rawDays)) {
          for (const item of rawDays) {
            const key =
              item.dateKey ??
              item.date ??
              item.day ??
              item.reservation_date;

            if (key) map[key] = item;
          }
        } else {
          for (const [key, value] of Object.entries(rawDays)) {
            map[key] = value;
          }
        }

        setCalendarMeta(map);
      } catch {
        if (alive) setCalendarMeta({});
      }
    }

    loadCalendarMeta();

    return () => {
      alive = false;
    };
  }, [isCalendarOpen, calendarMonth]);

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
    <main className="min-h-screen bg-stone-50 p-4 text-stone-900 [color-scheme:light]">
      <style jsx global>{`
        input,
        select,
        textarea,
        button {
          color-scheme: light;
        }

        input,
        select,
        textarea {
          color: #1c1917 !important;
          background-color: #ffffff !important;
          -webkit-text-fill-color: #1c1917 !important;
        }

        input::placeholder,
        textarea::placeholder {
          color: #78716c !important;
          opacity: 1 !important;
        }

        input:disabled,
        select:disabled,
        textarea:disabled {
          color: #44403c !important;
          background-color: #fafaf9 !important;
          -webkit-text-fill-color: #44403c !important;
          opacity: 1 !important;
        }
      `}</style>

      <div className="mx-auto max-w-[600px]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-stone-900">予約一覧</h1>
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
              type="button"
              onClick={() => setDateKey(formatDateKey(new Date()))}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700"
            >
              今日
            </button>
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setDateKey(addDays(dateKey, -1))}
            className="rounded-xl border bg-white px-3 py-2 text-stone-800"
          >
            ←
          </button>

          <div className="relative flex-1 text-center font-semibold">
            <button
              type="button"
              onClick={() => {
                setCalendarMonth(parseDateKey(dateKey));
                setIsCalendarOpen(true);
              }}
              className="w-full rounded-xl bg-white px-3 py-2 font-semibold text-stone-900"
            >
              {formatJP(dateKey)}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setDateKey(addDays(dateKey, 1))}
            className="rounded-xl border bg-white px-3 py-2 text-stone-800"
          >
            →
          </button>
        </div>

        {isCalendarOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-5 text-stone-900 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCalendarMonth((d) => addMonths(d, -1))}
                  className="rounded-xl px-4 py-2 text-2xl font-bold text-stone-800"
                >
                  ←
                </button>

                <div className="text-xl font-black">
                  {calendarMonth.getFullYear()}年{calendarMonth.getMonth() + 1}月
                </div>

                <button
                  type="button"
                  onClick={() => setCalendarMonth((d) => addMonths(d, 1))}
                  className="rounded-xl px-4 py-2 text-2xl font-bold text-stone-800"
                >
                  →
                </button>
              </div>

              <div className="grid grid-cols-7 gap-2 text-center text-sm font-bold text-stone-500">
                {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-7 gap-2">
                {buildCalendarDays(calendarMonth).map((day) => {
                  const key = formatDateKey(day);
                  const meta = calendarMeta[key];

                  const count =
                    meta?.count ??
                    meta?.reservationCount ??
                    meta?.reservations_count ??
                    meta?.reservation_count ??
                    meta?.total ??
                    0;

                  const isSelected = key === dateKey;
                  const isCurrentMonth = day.getMonth() === calendarMonth.getMonth();
                  const weekday = day.getDay();

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setDateKey(key);
                        setIsCalendarOpen(false);
                      }}
                      className={[
                        "min-h-[58px] rounded-2xl border bg-white px-1 py-2 text-center",
                        isSelected
                          ? "border-amber-500 bg-amber-50 ring-2 ring-amber-200"
                          : "border-stone-200",
                        !isCurrentMonth ? "opacity-30" : "",
                      ].join(" ")}
                    >
                      <div
                        className={[
                          "text-base font-black",
                          weekday === 0
                            ? "text-red-600"
                            : weekday === 6
                            ? "text-blue-600"
                            : "text-stone-900",
                        ].join(" ")}
                      >
                        {day.getDate()}
                      </div>

                      {count > 0 ? (
                        <div className="mt-1 text-xs font-bold text-rose-600">
                          {count}件
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-stone-300">-</div>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setIsCalendarOpen(false)}
                className="mt-5 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 font-bold text-stone-800"
              >
                閉じる
              </button>
            </div>
          </div>
        )}

        {loading && <div className="text-sm text-gray-500">読み込み中...</div>}

        <div className="space-y-3">
          {items.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelected(r)}
              className="cursor-pointer rounded-2xl bg-white p-4 shadow hover:bg-stone-50"
            >
              <div className="text-sm text-gray-500">
                {formatTime(r.startAt, r.durationMinutes)}
              </div>

              <div className="mt-1 text-lg font-bold text-stone-900">
                {r.name} 様
              </div>

              <div className="mt-1 text-sm text-gray-600">
                {r.persons}名 / {r.seatName}
              </div>
{r.notes ? (
  <div className="mt-3 whitespace-pre-wrap rounded-xl bg-stone-50 px-3 py-2 text-sm font-semibold leading-relaxed text-stone-700">
    備考：{r.notes}
  </div>
) : null}

              <div className="mt-2">
                <span className="rounded bg-green-600 px-2 py-1 text-xs text-white">
                  予約完了
                </span>
              </div>
            </div>
          ))}
        </div>

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
