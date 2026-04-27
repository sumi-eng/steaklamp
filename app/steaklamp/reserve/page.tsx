"use client";

import { useEffect, useMemo, useState } from "react";

type Plan = "seat_only" | "course_a" | "course_b" | "course_c";

type CalendarStatus = "available" | "few" | "full" | "closed";

type CalendarDayInfo = {
  status: CalendarStatus;
  count: number;
  isClosed: boolean;
};

type CalendarResponse = {
  ok: boolean;
  days: Record<string, CalendarDayInfo>;
};

type SeatCandidate = {
  id: string;
  name: string;
  capacityLabel: string;
  physicalSeats: string;
};

const SHOP_PHONE = "088-655-8623"; // 必要ならsteaklampの番号に変更
const SHOP_TEL_LINK = `tel:${SHOP_PHONE.replace(/-/g, "")}`;

const PLANS: Record<
  Plan,
  { label: string; price: number | null; help: string }
> = {
  seat_only: {
    label: "席のみ",
    price: null,
    help: "前日まで受付。お料理はご来店後にご注文ください。",
  },
  course_a: {
    label: "Aコース",
    price: 6600,
    help: "前日まで受付。6,600円（税込）",
  },
  course_b: {
    label: "Bコース",
    price: 8800,
    help: "前日まで受付。8,800円（税込）",
  },
  course_c: {
    label: "Cコース",
    price: 11000,
    help: "3日前まで受付。11,000円（税込）",
  },
};

function todayJstDateString() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseYmd(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function buildCalendarDays(monthDate: Date) {
  const first = startOfMonth(monthDate);
  const firstWeekday = first.getDay();
  const start = new Date(first);
  start.setDate(first.getDate() - firstWeekday);

  return Array.from({ length: 42 }).map((_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return {
      date: d,
      ymd: formatYmd(d),
      day: d.getDate(),
      inMonth: d.getMonth() === monthDate.getMonth(),
    };
  });
}

function monthLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function isBeforeDate(a: string, b: string) {
  return a < b;
}

function isAfterDate(a: string, b: string) {
  return a > b;
}

function isSameDate(a: string, b: string) {
  return a === b;
}

function isValidEmail(v: string) {
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function buildTimes() {
  const times: string[] = [];
  for (let h = 18; h <= 20; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 20 && m > 0) continue;
      times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return times;
}

export default function SteaklampReservePage() {
  const today = useMemo(() => todayJstDateString(), []);
  const [plan, setPlan] = useState<Plan>("seat_only");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [persons, setPersons] = useState(2);
  const [counterOk, setCounterOk] = useState(false);

  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    reservationId: string;
    assignedSeatLabel?: string | null;
  } | null>(null);

  const [calendarMap, setCalendarMap] = useState<Record<string, CalendarDayInfo>>({});
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [timeOptions, setTimeOptions] = useState<string[]>([]);
  const [timeLoading, setTimeLoading] = useState(false);

  const duration = 120;
  const allTimes = useMemo(() => buildTimes(), []);

  const minDate = useMemo(() => {
    if (plan === "course_c") return addDays(today, 3);
    return addDays(today, 1);
  }, [plan, today]);

  const maxDate = useMemo(() => {
    const base = parseYmd(today);
    const end = new Date(base.getFullYear(), base.getMonth() + 3, 0);
    return formatYmd(end);
  }, [today]);

  const [visibleMonth, setVisibleMonth] = useState<Date>(() =>
    startOfMonth(parseYmd(today))
  );

  useEffect(() => {
    if (!date || isBeforeDate(date, minDate)) {
      setDate(minDate);
    }
  }, [minDate]);

  useEffect(() => {
    const base = date ? parseYmd(date) : parseYmd(minDate);
    setVisibleMonth(startOfMonth(base));
  }, [date, minDate]);

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const minMonth = useMemo(() => startOfMonth(parseYmd(minDate)), [minDate]);
  const maxMonth = useMemo(() => startOfMonth(parseYmd(maxDate)), [maxDate]);

  const canPrevMonth = visibleMonth > minMonth;
  const canNextMonth = visibleMonth < maxMonth;

  useEffect(() => {
    let cancelled = false;

    async function fetchCalendar() {
      setCalendarLoading(true);

      try {
        const months = [
          addMonths(visibleMonth, -1),
          visibleMonth,
          addMonths(visibleMonth, 1),
        ];

        const results = await Promise.all(
          months.map(async (m) => {
            const qs = new URLSearchParams({
              month: monthKey(m),
              persons: String(persons),
              duration: String(duration),
              counterOk: counterOk ? "1" : "0",
            });

            const res = await fetch(`/api/steaklamp/calendar?${qs.toString()}`, {
              cache: "no-store",
            });

            const json = (await res.json().catch(() => ({}))) as CalendarResponse;
            if (!res.ok || !json.ok) return null;
            return json.days;
          })
        );

        const next: Record<string, CalendarDayInfo> = {};
        for (const result of results) {
          if (!result) continue;
          Object.assign(next, result);
        }

        if (!cancelled) setCalendarMap(next);
      } catch {
        if (!cancelled) setCalendarMap({});
      } finally {
        if (!cancelled) setCalendarLoading(false);
      }
    }

    fetchCalendar();

    return () => {
      cancelled = true;
    };
  }, [visibleMonth, persons, counterOk]);

  useEffect(() => {
    let cancelled = false;

    async function fetchTimes() {
      if (!date) return;

      setTimeLoading(true);

      try {
        const checks = await Promise.all(
          allTimes.map(async (t) => {
            const res = await fetch("/api/steaklamp/seats/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                persons,
                startAt: `${date}T${t}:00+09:00`,
                duration,
                counterOk,
              }),
            });

            const json = await res.json().catch(() => ({}));
            const seats = json.ok ? (json.seats as SeatCandidate[]) ?? [] : [];
            return seats.length > 0 ? t : null;
          })
        );

        const available = checks.filter(Boolean) as string[];

        if (!cancelled) {
  setTimeOptions(available);

  // 重要：
  // 人数変更などで選択中の時間が満席になっても、
  // 勝手に別の時間へ変更しない。
  // 予約確定時にエラーを出す。
}

      } catch {
        if (!cancelled) setTimeOptions([]);
      } finally {
        if (!cancelled) setTimeLoading(false);
      }
    }

    fetchTimes();

    return () => {
      cancelled = true;
    };
  }, [date, persons, counterOk]);

  function getCalendarStatus(
    ymd: string
  ): "available" | "few" | "full" | "closed" | "selected" {
    const item = calendarMap[ymd];

    if (!item) {
      if (isBeforeDate(ymd, minDate)) return "closed";
      if (isAfterDate(ymd, maxDate)) return "closed";
      if (date && isSameDate(ymd, date)) return "selected";
      return "closed";
    }

    if (date && isSameDate(ymd, date) && item.status !== "closed") {
      return "selected";
    }

    return item.status;
  }

  function validateBeforeSubmit() {
    if (!guestName.trim()) return "お名前を入力してください。";
    if (!phone.trim()) return "電話番号を入力してください。";
    if (!date) return "日付を選択してください。";
if (!time) return "時間を選択してください。";

if (!timeLoading && timeOptions.length > 0 && !timeOptions.includes(time)) {
  return "この条件ではご予約いただけません。人数または時間を変更してください。";
}

if (!Number.isFinite(persons) || persons <= 0) return "人数を確認してください。";

    if (!isValidEmail(email.trim())) return "メールアドレスの形式をご確認ください。";
    if (persons >= 13) return "13名以上のご予約はお電話でお問い合わせください。";
    if (date < minDate) return "受付期限を過ぎています。";
    if (date > maxDate) return "予約可能期間外です。";
    return null;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccess(null);

    const validationError = validateBeforeSubmit();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSubmitting(true);

    try {
      const startAt = `${date}T${time}:00+09:00`;

      const seatRes = await fetch("/api/steaklamp/seats/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persons, startAt, duration, counterOk }),
      });

      const seatJson = await seatRes.json();
      const candidates = seatJson.ok ? (seatJson.seats as SeatCandidate[]) ?? [] : [];

      if (candidates.length === 0) {
        setErrorMessage("申し訳ありません。この条件では空席がありません。");
        return;
      }

      const selectedSeat = candidates[0];

      const res = await fetch("/api/steaklamp/reservations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: guestName.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          persons,
          startAt,
          duration,
          notes: notes.trim() || null,
          counterOk,
          seatId: selectedSeat.id,
          course_id: null,
          course_name_snapshot: PLANS[plan].label,
          course_price_snapshot: PLANS[plan].price,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        setErrorMessage(json.detail || json.error || "ご予約を確定できませんでした。");
        return;
      }

      setSuccess({
        reservationId: json.reservation?.id ?? "",
        assignedSeatLabel: selectedSeat.name,
      });

      setGuestName("");
      setPhone("");
      setEmail("");
      setNotes("");
      setPersons(2);
      setCounterOk(false);
      setDate(minDate);
      setTime("18:00");
    } catch (err: any) {
      setErrorMessage(err?.message ?? "通信エラーが発生しました。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 sm:mb-8">
          <div className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Passion for Grilling Lamp
          </div>
          <div className="mt-2 text-sm text-stone-600 sm:text-base">ネット予約</div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-100 px-5 py-5 sm:px-8 sm:py-6">
            <div className="text-xl font-bold sm:text-2xl">ご予約フォーム</div>
            <div className="mt-2 text-sm text-stone-600">{PLANS[plan].help}</div>
          </div>

          <form onSubmit={handleSubmit} className="px-5 py-6 sm:px-8 sm:py-8">
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-stone-700">
              <div className="font-bold text-stone-900">ご予約前にご確認ください</div>
              <ul className="mt-2 space-y-1">
                <li>・営業時間は18:00〜22:00です。</li>
                <li>・ネット予約は18:00〜20:00開始、120分制です。</li>
                <li>・水曜日は定休日です。</li>
                <li>・Cコースは3日前までの受付です。</li>
                <li>・A/Bコース、席のみは前日までの受付です。</li>
              </ul>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-bold">プラン</label>
                <div className="grid gap-3 sm:grid-cols-4">
                  {(Object.keys(PLANS) as Plan[]).map((key) => (
                    <label
                      key={key}
                      className="cursor-pointer rounded-2xl border border-stone-200 p-4 hover:bg-stone-50"
                    >
                      <input
                        type="radio"
                        name="plan"
                        className="mr-2"
                        checked={plan === key}
                        onChange={() => {
                          setPlan(key);
                          setSuccess(null);
                          setErrorMessage(null);
                        }}
                      />
                      <span className="font-bold">{PLANS[key].label}</span>
                      <div className="mt-1 text-xs text-stone-600">{PLANS[key].help}</div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2 -mx-1 rounded-3xl border border-stone-200 bg-white p-3 sm:mx-0 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={!canPrevMonth}
                    onClick={() =>
                      setVisibleMonth((m) => {
                        const next = addMonths(m, -1);
                        return next < minMonth ? m : next;
                      })
                    }
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ←
                  </button>

                  <div className="text-lg font-bold text-stone-900">
                    {monthLabel(visibleMonth)}
                  </div>

                  <button
                    type="button"
                    disabled={!canNextMonth}
                    onClick={() =>
                      setVisibleMonth((m) => {
                        const next = addMonths(m, 1);
                        return next > maxMonth ? m : next;
                      })
                    }
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    →
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[13px] font-bold text-stone-500 sm:text-sm">
                  <div className="py-2 text-rose-500">日</div>
                  <div className="py-2">月</div>
                  <div className="py-2">火</div>
                  <div className="py-2">水</div>
                  <div className="py-2">木</div>
                  <div className="py-2">金</div>
                  <div className="py-2 text-blue-500">土</div>
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {calendarDays.map((cell) => {
                    const status = getCalendarStatus(cell.ymd);
                    const disabled = status === "closed" || status === "full";
                    const selected = status === "selected";

                    let mark = "×";
                    if (status === "available" || status === "selected") mark = "◯";
                    if (status === "few") mark = "△";
                    if (status === "full") mark = "×";
                    if (status === "closed") mark = "ー";

                    return (
                      <button
                        key={cell.ymd}
                        type="button"
                        onClick={() => {
                          if (disabled) return;
                          setDate(cell.ymd);
                          setErrorMessage(null);
                          setSuccess(null);
                        }}
                        disabled={disabled}
                        className={[
                          "flex min-h-[82px] flex-col items-center justify-between rounded-[22px] border px-1 py-2 text-center transition sm:min-h-[92px] sm:px-2 sm:py-3",
                          cell.inMonth
                            ? "border-stone-200 bg-white"
                            : "border-stone-100 bg-stone-50 text-stone-300",
                          disabled
                            ? "cursor-not-allowed opacity-60"
                            : "hover:border-amber-300 hover:bg-amber-50",
                          selected
                            ? "border-amber-500 bg-amber-500 shadow-sm ring-2 ring-amber-200"
                            : "",
                        ].join(" ")}
                      >
                        <div
                          className={[
                            "text-[15px] font-extrabold leading-none sm:text-sm",
                            selected
                              ? "text-black"
                              : cell.date.getDay() === 0
                              ? "text-rose-500"
                              : cell.date.getDay() === 6
                              ? "text-blue-500"
                              : "text-stone-800",
                          ].join(" ")}
                        >
                          {cell.day}
                        </div>

                        <div
                          className={[
                            "mt-1 text-[22px] font-bold leading-none sm:text-xl",
                            selected
                              ? "text-white"
                              : status === "available"
                              ? "text-emerald-600"
                              : status === "few"
                              ? "text-amber-600"
                              : status === "full"
                              ? "text-red-500"
                              : "text-stone-400",
                          ].join(" ")}
                        >
                          {mark}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap gap-4 text-xs text-stone-500">
                  <div className="text-emerald-600">○ 予約可</div>
                  <div className="text-amber-600">△ 残りわずか</div>
                  <div className="text-red-500">× 満席</div>
                  <div>ー 受付不可</div>
                  {calendarLoading ? <div>空席状況を確認中...</div> : null}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold">ご来店日</label>
                <input
                  type="text"
                  value={date}
                  readOnly
                  className="h-12 w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold">ご来店時間</label>
                <select
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={timeLoading || timeOptions.length === 0}
                  className="h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 outline-none focus:border-amber-500 disabled:bg-stone-100 disabled:text-stone-500"
                >
                  {timeOptions.length === 0 ? (
                    <option value="">
                      {timeLoading ? "時間候補を確認中..." : "選べる時間がありません"}
                    </option>
                  ) : null}

                  {time && !timeOptions.includes(time) ? (
  <option value={time}>
    {time}（この人数では空席不足）
  </option>
) : null}

{timeOptions.map((t) => (
  <option key={t} value={t}>
    {t}
  </option>
))}

              </select>

{time && !timeLoading && timeOptions.length > 0 && !timeOptions.includes(time) ? (
  <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
    この時間は人数条件に合うテーブル席が確保できません。
    人数を減らすか、別の時間をお選びください。
  </div>
) : null}



              </div>

              <div>
                <label className="mb-2 block text-sm font-bold">人数</label>
                <select
                  value={persons}
                  onChange={(e) => {
                    setPersons(Number(e.target.value));
                    setSuccess(null);
                    setErrorMessage(null);
                  }}
                  className="h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 outline-none focus:border-amber-500"
                >
                  {Array.from({ length: 12 }).map((_, i) => {
                    const n = i + 1;
                    return (
                      <option key={n} value={n}>
                        {n}名
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold">お席の希望</label>
                <label className="inline-flex h-12 items-center gap-2 rounded-2xl border border-stone-300 px-4">
                  <input
                    type="checkbox"
                    checked={counterOk}
                    onChange={(e) => setCounterOk(e.target.checked)}
                  />
                  カウンター席でも可
                </label>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold">お名前</label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="h-12 w-full rounded-2xl border border-stone-300 px-4 outline-none focus:border-amber-500"
                  placeholder="山田 太郎"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold">電話番号</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-12 w-full rounded-2xl border border-stone-300 px-4 outline-none focus:border-amber-500"
                  placeholder="09012345678"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-bold">メールアドレス</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 w-full rounded-2xl border border-stone-300 px-4 outline-none focus:border-amber-500"
                  placeholder="example@example.com"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-bold">備考</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 outline-none focus:border-amber-500"
                  placeholder="アレルギー、ご要望など"
                />
              </div>
            </div>

            {errorMessage ? (
              <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                {errorMessage}
              </div>
            ) : null}

            {success ? (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                <div className="font-bold">ご予約を受け付けました。</div>
                <div className="mt-2">
                  予約ID：<span className="font-bold">{success.reservationId}</span>
                </div>
                {success.assignedSeatLabel ? (
                  <div className="mt-1">ご案内席：{success.assignedSeatLabel}</div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6">
              {success ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <a
                    href="/steaklamp/reserve"
                    className="inline-flex h-12 items-center justify-center rounded-2xl bg-emerald-500 px-6 font-extrabold text-white shadow-sm hover:bg-emerald-400"
                  >
                    別の予約をする
                  </a>
                </div>
              ) : (
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                  <a
                    href={SHOP_TEL_LINK}
                    className="inline-flex h-12 items-center justify-center rounded-2xl border border-stone-300 px-6 font-bold text-stone-700 hover:bg-stone-50"
                  >
                    当日予約はお電話へ
                  </a>

                  <button
                    type="submit"
                    disabled={submitting || timeLoading}
                    className="inline-flex h-12 items-center justify-center rounded-2xl bg-amber-500 px-6 font-extrabold text-stone-900 shadow-sm hover:bg-amber-400 disabled:bg-stone-300 disabled:text-stone-500"
                  >
                    {submitting ? "送信中..." : "予約を確定する"}
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
