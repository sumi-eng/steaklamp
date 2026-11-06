// 予約の自由連結(reservation_seats)の読み書き。サーバー専用。
// 連結のない予約は行を持たず、reservations.seat_id だけで席を表す（従来どおり）。
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";
import type { SeatLinkMap } from "@/steaklamp/lib/inbound/seat-allocation";

const CHUNK = 150;

// テーブル未作成(SQL実行前)でも既存機能が止まらないようにする
function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /reservation_seats/.test(String(error.message ?? "")) &&
      /does not exist|schema cache/i.test(String(error.message ?? ""))
  );
}

// 予約IDの一覧から、自由連結した席IDを読み込む（連結のない予約はキーなし）
export async function loadSeatLinks(reservationIds: Array<string | null | undefined>): Promise<SeatLinkMap> {
  const ids = Array.from(new Set(reservationIds.filter(Boolean).map(String)));
  const map: SeatLinkMap = new Map();

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("reservation_seats")
      .select("reservation_id, seat_id")
      .in("reservation_id", chunk);

    if (error) {
      if (isMissingTable(error)) {
        console.warn("reservation_seats table is not available yet; treating as no links");
        return map;
      }
      throw error;
    }

    for (const row of data ?? []) {
      const key = String(row.reservation_id);
      const arr = map.get(key) ?? [];
      arr.push(String(row.seat_id));
      map.set(key, arr);
    }
  }

  return map;
}

// 予約の連結を、渡した席IDに置き換える（削除→挿入を1トランザクションで行う）。
// 1席以下のときは連結の行をすべて消す＝単独の席・グループ席に戻した場合に古い連結を残さない。
export async function replaceSeatLinks(reservationId: string, seatIds: string[]) {
  const ids = seatIds.length > 1 ? seatIds : [];
  const { error } = await supabaseAdmin.rpc("replace_reservation_seats", {
    p_reservation_id: reservationId,
    p_seat_ids: ids,
  });
  if (error) throw error;
}

// 取り込みメールなどで席が決まり直したときに、古い連結を消す。テーブル未作成なら何もしない。
export async function clearSeatLinks(reservationId: string) {
  try {
    await replaceSeatLinks(reservationId, []);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    // テーブル・関数が未作成の場合は、SQL実行前なので無視する
    if (isMissingTable(err) || err?.code === "PGRST202" || err?.code === "42883") return;
    // メール取り込みの処理は止めず、ログに残す（古い連結は代表席が変わっていれば無効として扱われる）
    console.error("clear reservation_seats failed", reservationId, e);
  }
}
