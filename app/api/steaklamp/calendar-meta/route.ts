import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function toDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function normalizeDateLike(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return toDateKey(d);
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toDateKey(value);
  }
  return null;
}

function pickDateKey(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const v = normalizeDateLike(row[key]);
    if (v) return v;
  }
  return null;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

const CROWDED_THRESHOLD = 4;
const FULL_THRESHOLD = 6;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month"); // YYYY-MM

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return json({ ok: false, error: "invalid_month" }, 400);
    }

    const viewDate = new Date(`${month}-01T00:00:00`);
    if (Number.isNaN(viewDate.getTime())) {
      return json({ ok: false, error: "invalid_month" }, 400);
    }

    const monthStart = startOfMonth(viewDate);
    const monthEnd = endOfMonth(viewDate);
    const rangeStart = addDays(monthStart, -93);
    const rangeEnd = addDays(monthEnd, 93);

    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id, code, name")
      .eq("code", "steaklamp")
      .single();

    if (storeError || !store) {
      return json({ ok: false, error: "store_not_found" }, 404);
    }

    const { data: reservations, error: reservationsError } = await supabaseAdmin
      .from("reservations")
      .select("id, start_at, duration_minutes, status")
      .eq("store_id", store.id)
      .in("status", ["booked", "confirmed", "seated"])
      .gte("start_at", rangeStart.toISOString())
      .lt("start_at", addDays(rangeEnd, 1).toISOString());

    if (reservationsError) {
      return json(
        { ok: false, error: "load_reservations_failed", detail: reservationsError.message },
        500
      );
    }

    const { data: businessHours, error: businessHoursError } = await supabaseAdmin
      .from("business_hours")
      .select("*")
      .eq("store_id", store.id);

    if (businessHoursError) {
      return json(
        { ok: false, error: "load_business_hours_failed", detail: businessHoursError.message },
        500
      );
    }

    const { data: specialClosures, error: specialClosuresError } = await supabaseAdmin
      .from("special_closures")
      .select("*")
      .eq("store_id", store.id);

    if (specialClosuresError) {
      return json(
        { ok: false, error: "load_special_closures_failed", detail: specialClosuresError.message },
        500
      );
    }

    const { data: holidays, error: holidaysError } = await supabaseAdmin
      .from("holidays")
      .select("*");

    if (holidaysError) {
      return json(
        { ok: false, error: "load_holidays_failed", detail: holidaysError.message },
        500
      );
    }

    const reservationCountsByDate: Record<string, number> = {};
    for (const row of reservations ?? []) {
      const startAt = new Date(String(row.start_at));
      if (Number.isNaN(startAt.getTime())) continue;
      const dateKey = toDateKey(startAt);
      reservationCountsByDate[dateKey] = (reservationCountsByDate[dateKey] ?? 0) + 1;
    }

    const holidaySet = new Set<string>();
    for (const row of holidays ?? []) {
      const dateKey = pickDateKey(row as Record<string, unknown>, [
        "holiday_date",
        "date",
        "day",
        "target_date",
        "closed_on",
      ]);
      if (dateKey) holidaySet.add(dateKey);
    }

    const weeklyClosedWeekdays = new Set<number>();
    for (const row of businessHours ?? []) {
      const weekday = Number((row as Record<string, unknown>).weekday);
      const isClosed = Boolean((row as Record<string, unknown>).is_closed);
      if (Number.isFinite(weekday) && isClosed) {
        weeklyClosedWeekdays.add(weekday);
      }
    }

    const specialClosureSet = new Set<string>();
    for (const row of specialClosures ?? []) {
      const record = row as Record<string, unknown>;

      const singleDate = pickDateKey(record, [
        "closed_on",
        "date",
        "day",
        "target_date",
      ]);
      if (singleDate) {
        specialClosureSet.add(singleDate);
        continue;
      }

      const startDate = pickDateKey(record, ["start_date", "from_date", "date_from"]);
      const endDate = pickDateKey(record, ["end_date", "to_date", "date_to"]);

      if (startDate && endDate) {
        let cursor = parseDateKey(startDate);
        const end = parseDateKey(endDate);
        while (cursor <= end) {
          specialClosureSet.add(toDateKey(cursor));
          cursor = addDays(cursor, 1);
        }
      }
    }

    const days: Record<
      string,
      {
        count: number;
        isHoliday: boolean;
        isClosed: boolean;
        isSpecialClosed: boolean;
        isCrowded: boolean;
        isFull: boolean;
      }
    > = {};

    let cursor = new Date(rangeStart);
    const hardEnd = addDays(rangeEnd, 1);

    while (cursor < hardEnd) {
      const dateKey = toDateKey(cursor);
      const weekday = cursor.getDay();
      const count = reservationCountsByDate[dateKey] ?? 0;
      const isHoliday = holidaySet.has(dateKey);
      const isSpecialClosed = specialClosureSet.has(dateKey);
      const isWeeklyClosed = weeklyClosedWeekdays.has(weekday);
      const isClosed = isSpecialClosed || isWeeklyClosed;

      days[dateKey] = {
        count,
        isHoliday,
        isClosed,
        isSpecialClosed,
        isCrowded: count >= CROWDED_THRESHOLD && count < FULL_THRESHOLD,
        isFull: count >= FULL_THRESHOLD,
      };

      cursor = addDays(cursor, 1);
    }

    return json({
      ok: true,
      month,
      thresholds: {
        crowded: CROWDED_THRESHOLD,
        full: FULL_THRESHOLD,
      },
      days,
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "calendar_meta_failed",
        detail: e instanceof Error ? e.message : "unknown_error",
      },
      500
    );
  }
}
