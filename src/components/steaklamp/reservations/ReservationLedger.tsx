"use client";

import { useEffect, useMemo, useState } from "react";
import ReservationCreateModal from "./ReservationCreateModal";
import ReservationDetailModal from "./ReservationDetailModal";

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(dateKey: string, days: number) {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + days);
  return formatDateKey(d);
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function formatMonthKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatJapaneseDate(dateKey: string) {
  const d = parseDateKey(dateKey);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}（${weekdays[d.getDay()]}）`;
}

function buildTimeSlots(startHour: number, endHour: number, stepMinutes: number) {
  const slots: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += stepMinutes) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
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

type RowDef = {
  id: string;
  label: string;
  capacityLabel: string;
};

type DayReservation = {
  id: string;
  seatId: string;
  dateKey: string;
  title: string;
  name?: string;
  phone?: string | null;
  email?: string | null;
  persons: number;
  start: string;
  startAt: string;
  slots: number;
  durationMinutes: number;
  seatName: string;
  status: string;
  notes?: string | null;
  rowIds: string[];
courseNameSnapshot?: string | null;
coursePriceSnapshot?: number | null;
course_name_snapshot?: string | null;
course_price_snapshot?: number | null;

};

type DayReservationsResponse = {
  ok: boolean;
  date: string;
  rows: RowDef[];
  items: DayReservation[];
};

type CalendarDayMeta = {
  date?: string;
  dateKey?: string;
  count?: number;
  reservationCount?: number;
  isClosed?: boolean;
  closed?: boolean;
  isHoliday?: boolean;
  holiday?: boolean;
  isSpecialClosed?: boolean;
  specialClosed?: boolean;
};

type CalendarMetaResponse = {
  ok: boolean;
  days?: CalendarDayMeta[];
  items?: CalendarDayMeta[];
};

export default function ReservationLedger() {
  const [dateKey, setDateKey] = useState(formatDateKey(new Date()));
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [rows, setRows] = useState<RowDef[]>([]);
  const [reservationsForDay, setReservationsForDay] = useState<DayReservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedReservation, setSelectedReservation] =
    useState<DayReservation | null>(null);

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => parseDateKey(dateKey));
  const [calendarMeta, setCalendarMeta] = useState<Record<string, CalendarDayMeta>>({});

const [dayClosure, setDayClosure] = useState<{
  closed_on: string;
  reason: string | null;
} | null>(null);

useEffect(() => {
  let alive = true;

  async function loadDayClosure() {
    try {
      const res = await fetch("/api/steaklamp/closures", {
        cache: "no-store",
      });
      const data = await res.json();

      if (!alive) return;

      if (data.ok) {
        const found = (data.items ?? []).find(
          (c: any) => c.closed_on === dateKey
        );

        setDayClosure(
          found
            ? {
                closed_on: found.closed_on,
                reason: found.reason ?? null,
              }
            : null
        );
      } else {
        setDayClosure(null);
      }
    } catch {
      if (alive) setDayClosure(null);
    }
  }

  loadDayClosure();

  return () => {
    alive = false;
  };
}, [dateKey, reloadTick]);



const [isClosureOpen, setIsClosureOpen] = useState(false);
const [closures, setClosures] = useState<any[]>([]);
const [closureDate, setClosureDate] = useState(dateKey);
const [closureReason, setClosureReason] = useState("臨時休業");
const [closureLoading, setClosureLoading] = useState(false);



  const timeSlots = useMemo(() => buildTimeSlots(18, 22, 15), []);
  const totalSlots = timeSlots.length;
  const rowHeight = 68;

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);

  useEffect(() => {
    let alive = true;

    async function loadDayReservations() {
      setLoading(true);

      try {
        const res = await fetch(`/api/steaklamp/reservations/day?date=${dateKey}`, {
          cache: "no-store",
        });

        const data = (await res.json()) as DayReservationsResponse;

        if (!alive) return;

        if (data.ok) {
          setRows(data.rows ?? []);
          setReservationsForDay(data.items ?? []);
        } else {
          setRows([]);
          setReservationsForDay([]);
        }
      } catch {
        if (!alive) return;
        setRows([]);
        setReservationsForDay([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadDayReservations();

    return () => {
      alive = false;
    };
  }, [dateKey, reloadTick]);

  useEffect(() => {
    let alive = true;

    async function loadCalendarMeta() {
      const month = formatMonthKey(calendarMonth);

      try {
        const res = await fetch(`/api/steaklamp/calendar-meta?month=${month}`, {
          cache: "no-store",
        });

        const data = (await res.json()) as CalendarMetaResponse;
        if (!alive) return;

        const rawDays =
  (data as any).days ??
  (data as any).items ??
  (data as any).calendar ??
  (data as any).dates ??
  (data as any).reservations ??
  {};

const map: Record<string, CalendarDayMeta> = {};

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
    map[key] = value as CalendarDayMeta;
  }
}

setCalendarMeta(map);

      } catch {
        if (alive) setCalendarMeta({});
      }
    }

    if (isCalendarOpen) loadCalendarMeta();

    return () => {
      alive = false;
    };
  }, [calendarMonth, isCalendarOpen, reloadTick]);

  function selectCalendarDate(key: string, meta?: CalendarDayMeta) {
    const closed =
      meta?.isClosed ||
      meta?.closed ||
      meta?.isSpecialClosed ||
      meta?.specialClosed;

    if (closed) return;

    setDateKey(key);
    setIsCalendarOpen(false);
  }

async function loadClosures() {
  const res = await fetch("/api/steaklamp/closures");
  const data = await res.json();
  if (data.ok) setClosures(data.items ?? []);
}

async function addClosure() {
  const res = await fetch("/api/steaklamp/closures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      closed_on: closureDate,
      reason: closureReason,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    alert("保存失敗");
    return;
  }

 await loadClosures();
setReloadTick((v) => v + 1);
setIsClosureOpen(false);
alert("休業日を登録しました");

}

async function deleteClosure(id: string) {
  if (!confirm("削除しますか？")) return;

  await fetch(`/api/steaklamp/closures/${id}`, {
    method: "DELETE",
  });

  await loadClosures();
  setReloadTick((v) => v + 1);
}

function openClosureModal() {
  setClosureDate(dateKey);
  setClosureReason("臨時休業");
  setIsClosureOpen(true);
  loadClosures();
}





  return (
    <main className="min-h-screen bg-stone-50 p-4 md:p-6">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
  <div>
    <h1 className="text-2xl font-bold text-stone-900">予約管理</h1>
    <p className="mt-1 text-sm text-stone-600">steaklamp</p>
  </div>


  <div className="flex gap-2">
    {/* リスト表示ボタン */}
    <a
      href="/steaklamp/admin/reservations/list"
      className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-100"
    >
      リスト表示
    </a>

    {/* 予約追加 */}
    <button
      type="button"
      onClick={() => setIsCreateOpen(true)}
      className="rounded-2xl bg-amber-500 px-5 py-3 text-sm font-semibold text-white hover:bg-amber-600"
    >
      ＋ 予約追加
    </button>
  </div>
</div>


        <div className="relative mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCalendarMonth(parseDateKey(dateKey));
              setIsCalendarOpen((v) => !v);
            }}
            className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-800"
          >
            {formatJapaneseDate(dateKey)}
          </button>

<a
  href="/steaklamp/admin/reservations/history"
  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold"
>
  予約一覧
</a>

<button
  type="button"
  onClick={openClosureModal}
  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold"
>
  休業日設定
</button>

<button
  type="button"
  onClick={() => setDateKey(addDays(dateKey, -1))}
  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold"
>
  前日
</button>

<button
  type="button"
  onClick={() => setDateKey(formatDateKey(new Date()))}
  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold"
>
  今日
</button>

<button
  type="button"
  onClick={() => setDateKey(addDays(dateKey, 1))}
  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold"
>
  翌日
</button>

          {loading && <div className="ml-2 text-sm text-stone-500">読み込み中...</div>}

{dayClosure && (
  <div className="w-full rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 text-emerald-800">
    <div className="text-lg font-bold">本日は休業日です</div>
    <div className="mt-1 text-sm font-semibold">
      {dayClosure.reason || "臨時休業"}
    </div>
  </div>
)}


          {isCalendarOpen && (
            <div className="absolute left-0 top-16 z-40 w-[560px] max-w-[calc(100vw-2rem)] rounded-3xl border border-stone-200 bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCalendarMonth((d) => addMonths(d, -1))}
                  className="rounded-xl px-3 py-2 text-lg font-bold text-stone-600 hover:bg-stone-100"
                >
                  ←
                </button>

                <div className="text-lg font-bold text-stone-900">
                  {calendarMonth.getFullYear()}/{String(calendarMonth.getMonth() + 1).padStart(2, "0")}
                </div>

                <button
                  type="button"
                  onClick={() => setCalendarMonth((d) => addMonths(d, 1))}
                  className="rounded-xl px-3 py-2 text-lg font-bold text-stone-600 hover:bg-stone-100"
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
                {calendarDays.map((day) => {
                  const key = formatDateKey(day);
                  const meta = calendarMeta[key];
                  const count =
  meta?.count ??
  meta?.reservationCount ??
  (meta as any)?.reservations_count ??
  (meta as any)?.reservation_count ??
  (meta as any)?.total ??
  0;

                  const isCurrentMonth = day.getMonth() === calendarMonth.getMonth();
                  const weekday = day.getDay();
                  const isSelected = key === dateKey;

                  const isClosed =
                    meta?.isClosed ||
                    meta?.closed ||
                    meta?.isSpecialClosed ||
                    meta?.specialClosed;

                  const isHoliday = meta?.isHoliday || meta?.holiday;

                  let dayColor = "text-stone-800";
                  if (weekday === 6) dayColor = "text-blue-600";
                  if (weekday === 0 || isHoliday) dayColor = "text-red-600";
                  if (isClosed) dayColor = "text-emerald-700";

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={Boolean(isClosed)}
                      onClick={() => selectCalendarDate(key, meta)}
                      className={[
                        "h-16 rounded-2xl border text-center transition",
                        isSelected
                          ? "border-amber-500 bg-amber-50"
                          : "border-stone-200 bg-white hover:bg-stone-50",
                        !isCurrentMonth ? "opacity-35" : "",
                        isClosed ? "cursor-not-allowed bg-emerald-50 opacity-70" : "",
                      ].join(" ")}
                    >
                      <div className={`text-base font-bold ${dayColor}`}>
                        {day.getDate()}
                      </div>

                      {isClosed ? (
                        <div className="mt-0.5 text-xs font-bold text-emerald-700">
                          休
                        </div>
                      ) : count > 0 ? (
                        <div className="mt-0.5 text-xs font-bold text-stone-600">
                          {count}件
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-3xl border border-stone-200 bg-white shadow-sm">
          <div
            className="grid min-w-[1200px]"
            style={{
              gridTemplateColumns: `120px repeat(${totalSlots}, minmax(72px, 1fr))`,
            }}
          >
            <div className="sticky left-0 z-20 border-b border-r border-stone-200 bg-stone-900 px-4 py-4 text-sm font-bold text-white">
              席
            </div>

            {timeSlots.map((slot) => (
              <div
                key={slot}
                className="border-b border-r border-stone-700 bg-stone-900 px-2 py-4 text-center text-sm font-bold text-white"
              >
                {slot}
              </div>
            ))}

            <div className="sticky left-0 z-10 bg-white">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="border-b border-r border-stone-200 px-3 py-2"
                  style={{ height: `${rowHeight}px` }}
                >
                  <div className="text-base font-bold text-stone-900">{row.label}</div>
                  <div className="mt-0.5 text-xs font-bold text-stone-600">
                    {row.capacityLabel.replace("名", "")}
                  </div>
                </div>
              ))}
            </div>

            <div
              className="relative"
              style={{
                gridColumn: `2 / span ${totalSlots}`,
                height: `${rows.length * rowHeight}px`,
              }}
            >
{dayClosure && (
  <div className="absolute inset-0 z-30 flex items-center justify-center rounded-none border-2 border-red-300 bg-red-100/80 text-red-800">
    <div className="rounded-3xl bg-white/90 px-8 py-6 text-center shadow">
      <div className="text-3xl font-black">休業日</div>
      <div className="mt-2 text-lg font-bold">
        {dayClosure.reason || "臨時休業"}
      </div>
    </div>
  </div>
)}

              {rows.map((row, rowIndex) => (
                <div
                  key={row.id}
                  className="absolute left-0 right-0 grid border-b border-stone-200"
                  style={{
                    top: `${rowIndex * rowHeight}px`,
                    height: `${rowHeight}px`,
                    gridTemplateColumns: `repeat(${totalSlots}, minmax(72px, 1fr))`,
                  }}
                >
                  {timeSlots.map((slot, index) => (
                    <div
                      key={`${row.id}-${slot}`}
                      className={`border-r border-stone-100 ${
                        index % 4 === 0 ? "bg-stone-50/70" : "bg-white"
                      }`}
                    />
                  ))}
                </div>
              ))}

              {reservationsForDay.map((reservation) => {
                const startIndex = timeSlots.indexOf(reservation.start);
                if (startIndex < 0) return null;

                const rowIndexes = reservation.rowIds
                  .map((id) => rows.findIndex((r) => r.id === id))
                  .filter((i) => i >= 0)
                  .sort((a, b) => a - b);

                if (rowIndexes.length === 0) return null;

                const topRow = rowIndexes[0];
                const bottomRow = rowIndexes[rowIndexes.length - 1];
                const rowSpan = bottomRow - topRow + 1;

                return (
                  <div
                    key={reservation.id}
                    onClick={() => setSelectedReservation(reservation)}
                    className="absolute cursor-pointer rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 shadow-sm hover:ring-2 hover:ring-rose-200"
                    style={{
                      top: `${topRow * rowHeight + 8}px`,
                      height: `${rowSpan * rowHeight - 16}px`,
                      left: `calc(${(startIndex / totalSlots) * 100}% + 4px)`,
                      width: `calc(${(reservation.slots / totalSlots) * 100}% - 8px)`,
                    }}
                  >
                    <div className="text-[12px] font-semibold leading-tight text-rose-700">
  {reservation.start} {reservation.persons}名 {reservation.seatName}
</div>

<div className="mt-1 text-[14px] font-bold leading-tight">
  {reservation.title}
</div>

{reservation.notes ? (
  <div className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-white/70 px-2 py-1 text-[13px] font-semibold leading-snug text-rose-700">
    備考：{reservation.notes}
  </div>
) : null}

                  </div>
                );
              })}
            </div>
          </div>
        </div>

{isClosureOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div className="w-full max-w-md rounded-3xl bg-white p-5">
      <h2 className="text-lg font-bold mb-3">休業日設定</h2>

      <input
        type="date"
        value={closureDate}
        onChange={(e) => setClosureDate(e.target.value)}
        className="w-full border p-2 mb-2"
      />

      <input
        value={closureReason}
        onChange={(e) => setClosureReason(e.target.value)}
        className="w-full border p-2 mb-3"
      />

      <button
        onClick={addClosure}
        className="w-full bg-emerald-600 text-white p-2 rounded mb-3"
      >
        登録
      </button>

      <div className="max-h-40 overflow-auto space-y-2">
        {closures.map((c) => (
          <div key={c.id} className="flex justify-between text-sm">
            <span>{c.closed_on}</span>
            <button onClick={() => deleteClosure(c.id)}>削除</button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setIsClosureOpen(false)}
        className="mt-3 w-full border p-2"
      >
        閉じる
      </button>
    </div>
  </div>
)}


        {isCreateOpen && (
          <ReservationCreateModal
            defaultDateKey={dateKey}
            onClose={() => setIsCreateOpen(false)}
            onCreated={() => {
              setReloadTick((v) => v + 1);
            }}
          />
        )}

        {selectedReservation && (
          <ReservationDetailModal
            reservation={{
              id: selectedReservation.id,
              seatId: selectedReservation.seatId,
              title: selectedReservation.title,
              name: selectedReservation.name ?? selectedReservation.title,
              phone: selectedReservation.phone,
              email: selectedReservation.email,
              persons: selectedReservation.persons,
              startAt: selectedReservation.startAt,
              durationMinutes: selectedReservation.durationMinutes,
              notes: selectedReservation.notes,
              seatName: selectedReservation.seatName,
courseNameSnapshot: (selectedReservation as any).courseNameSnapshot ?? null,
coursePriceSnapshot: (selectedReservation as any).coursePriceSnapshot ?? null,

            }}
            onClose={() => setSelectedReservation(null)}
            onUpdated={() => setReloadTick((v) => v + 1)}
          />
        )}
      </div>
    </main>
  );
}
