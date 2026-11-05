// クリスマスコース：DBの読み書きと、上限・満席のLINE通知。
// 自社ページ・電話予約・外部サイト取込のすべてが、予約の保存後にここを呼ぶ。

import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import { sendLineText } from "@/steaklamp/lib/lineNotify";
import {
  CHRISTMAS,
  capacityNotice,
  dateLabel,
  evaluateRegistrationOrder,
  isChristmasCourse,
  isChristmasDate,
  jstDateKey,
  jstTimeKey,
  summarizeDay,
  type ChristmasRow,
  type DaySummary,
} from "@/steaklamp/lib/christmas";

export async function getSteaklampStoreId() {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("code", "steaklamp")
    .single();
  if (error || !data) throw new Error(error?.message ?? "store_not_found");
  return String(data.id);
}

// 対象2日間のクリスマス予約（キャンセル含む。数える側で除外する）
export async function loadChristmasRows(storeId: string): Promise<ChristmasRow[]> {
  const first = CHRISTMAS.dates[0];
  const last = CHRISTMAS.dates[CHRISTMAS.dates.length - 1];
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select("id, created_at, start_at, persons, status, course_name_snapshot")
    .eq("store_id", storeId)
    .gte("start_at", `${first}T00:00:00+09:00`)
    .lte("start_at", `${last}T23:59:59+09:00`);
  if (error) throw error;
  return ((data ?? []) as ChristmasRow[]).filter((r) =>
    isChristmasCourse(r.course_name_snapshot)
  );
}

// 手動で締め切られた日。テーブルが無い・読めない場合は締切なしとして扱う（ログを残す）
export async function loadClosedDates(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("christmas_day_settings")
    .select("event_date, is_closed");
  if (error) {
    console.error("christmas_day_settings load failed", error.message);
    return new Set();
  }
  return new Set(
    (data ?? [])
      .filter((r: { is_closed: boolean }) => r.is_closed)
      .map((r: { event_date: string }) => String(r.event_date))
  );
}

export async function loadDaySummaries(storeId: string) {
  const [rows, closed] = await Promise.all([
    loadChristmasRows(storeId),
    loadClosedDates(),
  ]);
  const summaries: DaySummary[] = CHRISTMAS.dates.map((d) =>
    summarizeDay(rows, d, closed.has(d))
  );
  return { rows, summaries };
}

function limitText(s: { usedGroups: number; usedPersons: number }) {
  return `現在 ${s.usedGroups}組・${s.usedPersons}名（上限 ${CHRISTMAS.maxGroups}組・${CHRISTMAS.maxPersons}名）`;
}

function mdLabel(dateKey: string) {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}/${d}`;
}

// 予約を保存した直後に呼ぶ。上限超過・満席・残り1組をLINEで知らせる。
// 返り値の over が true のときは、台帳には入っているが上限を超えている（要確認）。
export async function afterChristmasReservationSaved(args: {
  storeId: string;
  reservationId: string;
  sourceLabel: string;
}): Promise<{ over: boolean; notified: "over" | "full" | "one_left" | null }> {
  const rows = await loadChristmasRows(args.storeId);
  const target = rows.find((r) => String(r.id) === String(args.reservationId));
  if (!target) return { over: false, notified: null };

  const dateKey = jstDateKey(target.start_at);
  if (!isChristmasDate(dateKey)) return { over: false, notified: null };

  const closed = await loadClosedDates();
  const order = evaluateRegistrationOrder(rows, target, dateKey);

  if (order.over) {
    const after = summarizeDay(rows, dateKey, closed.has(dateKey));
    await sendLineText(
      [
        `【上限超過・要確認】${mdLabel(dateKey)} クリスマスコース`,
        "",
        `上限を超える予約が入りました。台帳には登録済みです。お客様への連絡が必要です。`,
        `経路：${args.sourceLabel}`,
        `日時：${dateLabel(dateKey)} ${jstTimeKey(target.start_at)}`,
        `人数：${target.persons ?? "-"}名`,
        limitText(after),
      ].join("\n")
    );
    return { over: true, notified: "over" };
  }

  const withoutTarget = rows.filter((r) => String(r.id) !== String(target.id));
  const before = summarizeDay(withoutTarget, dateKey, closed.has(dateKey));
  const after = summarizeDay(rows, dateKey, closed.has(dateKey));
  const notice = capacityNotice(before, after);

  if (notice === "full") {
    await sendLineText(
      [
        `【Lamp】${mdLabel(dateKey)} 満席になりました。ホットペッパー・食べログ・一休の受付を止めてください`,
        "",
        `クリスマスコース ${limitText(after)}`,
      ].join("\n")
    );
  } else if (notice === "one_left") {
    await sendLineText(
      [
        `【Lamp】${mdLabel(dateKey)} クリスマスコース 残り1組になりました`,
        "",
        `${limitText(after)}／残り${after.remainingPersons}名`,
      ].join("\n")
    );
  }

  return { over: false, notified: notice };
}
