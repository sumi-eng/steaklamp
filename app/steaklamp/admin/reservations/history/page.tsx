"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

const STEAKLAMP_STORE_ID = "368af618-50ed-472f-b631-6affd46b45f3";

type ReservationRow = {
  id: string;
  store_id: string | null;
  seat_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  persons: number | null;
  start_at: string | null;
  duration_minutes: number | null;
  status: string | null;
  notes: string | null;
  source: string | null;
  course_name_snapshot: string | null;
  course_price_snapshot: number | null;
  created_at: string | null;
  updated_at: string | null;
  cancelled_at: string | null;
  external_source?: string | null;
  external_reservation_id?: string | null;
};

type SeatRow = {
  id: string;
  name: string;
};

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function fmtTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function statusLabel(status?: string | null) {
  switch (status) {
    case "booked":
      return "予約";
    case "seated":
      return "来店済み";
    case "payment":
      return "会計中";
    case "waiting":
      return "待機";
    case "finished":
      return "完了";
    case "cancelled":
      return "キャンセル";
    case "no_show":
      return "無断不来店";
    default:
      return status || "—";
  }
}

function sourceLabel(row: ReservationRow) {
  const s = row.external_source || row.source;
  switch (s) {
    case "hotpepper":
      return "ホットペッパー";
    case "tabelog":
      return "食べログ";
    case "web":
      return "Web";
    case "admin":
      return "手入力";
    default:
      return s || "—";
  }
}

export default function SteaklampReservationHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function refresh() {
  setLoading(true);
  setErr(null);

  try {
    const res = await fetch(
      "/api/steaklamp/reservations/history",
      { cache: "no-store" }
    );

    const data = await res.json();

    if (!data.ok) throw new Error(data.error);

    setRows(data.items || []);
  } catch (e: any) {
    setErr(e.message);
  } finally {
    setLoading(false);
  }
}

  useEffect(() => {
    refresh();
  }, []);

 
  const filteredRows = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!qq) return true;

      const seatName = r.seat_id ? seatMap.get(r.seat_id) ?? "" : "";

      return (
        String(r.name ?? "").toLowerCase().includes(qq) ||
        String(r.phone ?? "").toLowerCase().includes(qq) ||
        String(r.email ?? "").toLowerCase().includes(qq) ||
        String(seatName).toLowerCase().includes(qq)
      );
    });
  }, [rows, q, statusFilter, seatMap]);

  return (
    <div className="min-h-screen bg-zinc-950 p-4 text-zinc-100">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">予約一覧・履歴</h1>
            <p className="mt-1 text-sm text-zinc-400">
              新しく入った予約を上から確認できます
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/steaklamp/admin"
              className="rounded-xl border border-zinc-700 px-3 py-2 text-sm"
            >
              管理トップへ
            </Link>
            <Link
              href="/steaklamp/admin/reservations"
              className="rounded-xl border border-zinc-700 px-3 py-2 text-sm"
            >
              予約台帳へ
            </Link>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="名前・電話・メール・席名で検索"
              className="h-11 rounded-xl border border-zinc-800 bg-zinc-950 px-3 md:w-96"
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-11 rounded-xl border border-zinc-800 bg-zinc-950 px-3 md:w-48"
            >
              <option value="all">すべて</option>
              <option value="booked">予約</option>
              <option value="seated">来店済み</option>
              <option value="payment">会計中</option>
              <option value="finished">完了</option>
              <option value="cancelled">キャンセル</option>
              <option value="no_show">無断不来店</option>
            </select>

            <button
              type="button"
              onClick={refresh}
              className="h-11 rounded-xl border border-zinc-700 px-4 text-sm"
            >
              再読み込み
            </button>
          </div>
        </div>

        {err && (
          <div className="mt-4 rounded-2xl border border-rose-900/50 bg-rose-950/30 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          {loading ? (
            <div className="p-6 text-sm text-zinc-400">読み込み中...</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-6 text-sm text-zinc-400">
              該当データがありません
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1100px] w-full text-sm">
                <thead className="bg-zinc-950">
                  <tr className="text-left text-zinc-300">
                    <th className="px-3 py-3">作成日時</th>
                    <th className="px-3 py-3">来店日</th>
                    <th className="px-3 py-3">時間</th>
                    <th className="px-3 py-3">名前</th>
                    <th className="px-3 py-3">電話</th>
                    <th className="px-3 py-3">人数</th>
                    <th className="px-3 py-3">席</th>
                    <th className="px-3 py-3">経路</th>
                    <th className="px-3 py-3">状態</th>
                    <th className="px-3 py-3">コース</th>
                    <th className="px-3 py-3">備考</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-800">
                      <td className="px-3 py-3 whitespace-nowrap">
                        {fmtDateTime(r.created_at)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {fmtDate(r.start_at)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {fmtTime(r.start_at)}
                      </td>
                      <td className="px-3 py-3 font-semibold">
                        {r.name || "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {r.phone || "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {r.persons ?? "—"}名
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {r.seat_id ? seatMap.get(r.seat_id) ?? "—" : "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {sourceLabel(r)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {statusLabel(r.status)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {r.course_name_snapshot || "—"}
                      </td>
                      <td className="px-3 py-3 max-w-[320px] whitespace-pre-wrap break-words">
                        {r.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
