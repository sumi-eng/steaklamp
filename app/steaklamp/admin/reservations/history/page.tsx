"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/steaklamp/lib/supabaseClient";

type ReservationHistoryRow = {
  id: string;
  seat_id: string;
  name: string | null;
  phone: string | null;
  persons: number | null;
  start_at: string;
  end_at: string;
  status: string;
  notes: string | null;
  source: string | null;
  reservation_plan_name_snapshot: string | null;
  reservation_plan_price_snapshot: number | null;
  created_at: string | null;
  updated_at: string | null;
  cancelled_at: string | null;
};

type SeatRow = {
  id: string;
  name: string;
};

function fmtDateTime(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function fmtTime(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function statusLabel(status: string) {
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
      return status;
  }
}

export default function ReservationHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [rows, setRows] = useState<ReservationHistoryRow[]>([]);
  const [seats, setSeats] = useState<SeatRow[]>([]);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function refresh() {
    setLoading(true);
    setErr(null);

    try {
      const [reservationsRes, seatsRes] = await Promise.all([
        supabase
  .from("reservations")
  .select(`
    id,
    seat_id,
    name,
    phone,
    persons,
    start_at,
    end_at,
    status,
    notes,
    source,
    course_name_snapshot,
    course_price_snapshot,
    created_at,
    updated_at,
    cancelled_at
  `)
  .eq("store_id", "368af618-50ed-472f-b631-6affd46b45f3") // ←追加
  .order("created_at", { ascending: false })
  .limit(500),


        supabase
          .from("seats")
          .select("id, name")
          .order("sort_order", { ascending: true }),
      ]);

      if (reservationsRes.error) throw reservationsRes.error;
      if (seatsRes.error) throw seatsRes.error;

      setRows((reservationsRes.data ?? []) as ReservationHistoryRow[]);
      setSeats((seatsRes.data ?? []) as SeatRow[]);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const seatMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of seats) m.set(s.id, s.name);
    return m;
  }, [seats]);

  const filteredRows = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;

      if (!qq) return true;

      return (
        String(r.name ?? "").toLowerCase().includes(qq) ||
        String(r.phone ?? "").toLowerCase().includes(qq) ||
        String(seatMap.get(r.seat_id) ?? "").toLowerCase().includes(qq)
      );
    });
  }, [rows, q, statusFilter, seatMap]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">予約履歴</div>
            <div className="text-sm text-zinc-400 mt-1">
              予約作成・来店・キャンセルの確認用一覧
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/steaklamp/admin"
              className="px-3 h-10 rounded-xl border border-zinc-700 text-sm inline-flex items-center"
            >
              管理トップへ
            </Link>
            <Link
              href="/steaklamp/admin/reservations"
              className="px-3 h-10 rounded-xl border border-zinc-700 text-sm inline-flex items-center"
            >
              予約台帳へ
            </Link>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 flex flex-col md:flex-row gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名前・電話・席名で検索"
            className="h-11 rounded-xl bg-zinc-950 border border-zinc-800 px-3 md:w-80"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-11 rounded-xl bg-zinc-950 border border-zinc-800 px-3 md:w-48"
          >
            <option value="all">すべて</option>
            <option value="booked">予約</option>
            <option value="seated">来店済み</option>
            <option value="payment">会計中</option>
            <option value="waiting">待機</option>
            <option value="finished">完了</option>
            <option value="cancelled">キャンセル</option>
            <option value="no_show">無断不来店</option>
          </select>

          <button
            type="button"
            onClick={refresh}
            className="h-11 px-4 rounded-xl border border-zinc-700 text-sm"
          >
            再読み込み
          </button>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-900/50 bg-rose-950/30 p-3 text-sm text-rose-200">
            {err}
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          {loading ? (
            <div className="p-6 text-sm text-zinc-400">読み込み中...</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-6 text-sm text-zinc-400">該当データがありません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-950">
                  <tr className="text-left text-zinc-300">
                    <th className="px-3 py-3">来店日</th>
                    <th className="px-3 py-3">時間</th>
                    <th className="px-3 py-3">名前</th>
                    <th className="px-3 py-3">電話</th>
                    <th className="px-3 py-3">人数</th>
                    <th className="px-3 py-3">席</th>
                    <th className="px-3 py-3">状態</th>
                    <th className="px-3 py-3">プラン</th>
                    <th className="px-3 py-3">作成日時</th>
                    <th className="px-3 py-3">キャンセル日時</th>
                    <th className="px-3 py-3">備考</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-800">
                      <td className="px-3 py-3 whitespace-nowrap">
                        {fmtDate(r.start_at)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {fmtTime(r.start_at)}
                      </td>
                      <td className="px-3 py-3">{r.name || "—"}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {r.phone || "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {r.persons ?? "—"}名
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {seatMap.get(r.seat_id) ?? r.seat_id}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {statusLabel(r.status)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {r.reservation_plan_name_snapshot || "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {fmtDateTime(r.created_at)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {fmtDateTime(r.cancelled_at)}
                      </td>
                      <td className="px-3 py-3 max-w-[280px] whitespace-pre-wrap break-words">
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


