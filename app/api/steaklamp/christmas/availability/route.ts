import { NextResponse } from "next/server";
import {
  CHRISTMAS,
  dateLabel,
  isReceptionOpen,
} from "@/steaklamp/lib/christmas";
import {
  getSteaklampStoreId,
  loadDaySummaries,
} from "@/steaklamp/lib/christmas-server";
import { findSeat } from "@/steaklamp/lib/inbound/hotpepper-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 日付ごとの残り組数・名数と、開始時刻ごとの空き（席が取れるか）を返す。
// 席は通常の予約と同じ割り当てロジックで確認し、取れない時刻は選べないようにする。
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const personsParam = Number(url.searchParams.get("persons") ?? CHRISTMAS.minPartySize);
    const persons = Math.min(
      CHRISTMAS.maxPartySize,
      Math.max(CHRISTMAS.minPartySize, Number.isFinite(personsParam) ? personsParam : 2)
    );

    const storeId = await getSteaklampStoreId();
    const { summaries } = await loadDaySummaries(storeId);
    const now = new Date();
    const open = isReceptionOpen(now);

    const dates = await Promise.all(
      summaries.map(async (s) => {
        const bookable = open && s.maxSelectablePersons >= CHRISTMAS.minPartySize;

        const times = await Promise.all(
          CHRISTMAS.times.map(async (time) => {
            if (!bookable) {
              return { time, available: false, reason: s.closed ? "closed" : "full" };
            }
            if (persons > s.maxSelectablePersons) {
              return { time, available: false, reason: "persons" };
            }
            const startAt = new Date(`${s.date}T${time}:00+09:00`);
            if (startAt.getTime() < now.getTime()) {
              return { time, available: false, reason: "past" };
            }
            const choice = await findSeat({
              storeId,
              persons,
              startAt,
              duration: CHRISTMAS.durationMinutes,
              counterOk: false,
            });
            return choice.seat
              ? { time, available: true }
              : { time, available: false, reason: "no_seat" };
          })
        );

        return {
          date: s.date,
          label: dateLabel(s.date),
          closed: s.closed,
          full: s.full || s.maxSelectablePersons === 0,
          usedGroups: s.usedGroups,
          usedPersons: s.usedPersons,
          remainingGroups: s.remainingGroups,
          remainingPersons: s.remainingPersons,
          maxSelectablePersons: s.maxSelectablePersons,
          times,
        };
      })
    );

    return NextResponse.json(
      {
        ok: true,
        receptionOpen: open,
        opensAt: CHRISTMAS.opensAt,
        closesAt: CHRISTMAS.closesAt,
        persons,
        dates,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown_error" },
      { status: 500 }
    );
  }
}
