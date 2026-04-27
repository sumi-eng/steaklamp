"use client";

import { useEffect, useState } from "react";

type Row = {
  id?: string;
  store_id?: string;
  weekday: number;
  is_closed: boolean;
  open_on_day_before_holiday: boolean;
  open_time: string | null;
  close_time: string | null;
  reservation_start_time: string | null;
  reservation_end_time: string | null;
  reservation_interval_minutes: number;
  default_stay_minutes: number;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export default function BusinessHoursEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMessage("");

      const res = await fetch("/api/steaklamp/admin/business-hours", {
        cache: "no-store",
      });
      const json = await res.json();

      if (json?.ok) {
        setStoreName(json.store?.name ?? "");
        setRows(json.rows ?? []);
      } else {
        setMessage("読み込みに失敗しました。");
      }

      setLoading(false);
    })();
  }, []);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");

    const res = await fetch("/api/steaklamp/admin/business-hours", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rows }),
    });

    const json = await res.json();

    if (json?.ok) {
      setMessage("保存しました。");
    } else {
      setMessage("保存に失敗しました。");
    }

    setSaving(false);
  }

  if (loading) {
    return <main className="p-6">読み込み中...</main>;
  }

  return (
    <main className="min-h-screen bg-stone-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-stone-900">営業時間設定</h1>
          <p className="mt-1 text-sm text-stone-600">{storeName}</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-stone-100 text-stone-700">
              <tr>
                <th className="px-3 py-3 text-left">曜日</th>
                <th className="px-3 py-3 text-left">定休日</th>
                <th className="px-3 py-3 text-left">祝前日は営業</th>
                <th className="px-3 py-3 text-left">営業開始</th>
                <th className="px-3 py-3 text-left">営業終了</th>
                <th className="px-3 py-3 text-left">予約開始</th>
                <th className="px-3 py-3 text-left">予約終了</th>
                <th className="px-3 py-3 text-left">刻み(分)</th>
                <th className="px-3 py-3 text-left">滞在(分)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.weekday} className="border-t border-stone-200">
                  <td className="px-3 py-3 font-medium text-stone-900">
                    {WEEKDAYS[row.weekday]}
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={row.is_closed}
                      onChange={(e) =>
                        updateRow(index, {
                          is_closed: e.target.checked,
                        })
                      }
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={row.open_on_day_before_holiday}
                      onChange={(e) =>
                        updateRow(index, {
                          open_on_day_before_holiday: e.target.checked,
                        })
                      }
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="time"
                      value={row.open_time ?? ""}
                      disabled={row.is_closed}
                      onChange={(e) =>
                        updateRow(index, { open_time: e.target.value || null })
                      }
                      className="rounded-lg border border-stone-300 px-2 py-1"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="time"
                      value={row.close_time ?? ""}
                      disabled={row.is_closed}
                      onChange={(e) =>
                        updateRow(index, { close_time: e.target.value || null })
                      }
                      className="rounded-lg border border-stone-300 px-2 py-1"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="time"
                      value={row.reservation_start_time ?? ""}
                      disabled={row.is_closed}
                      onChange={(e) =>
                        updateRow(index, {
                          reservation_start_time: e.target.value || null,
                        })
                      }
                      className="rounded-lg border border-stone-300 px-2 py-1"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="time"
                      value={row.reservation_end_time ?? ""}
                      disabled={row.is_closed}
                      onChange={(e) =>
                        updateRow(index, {
                          reservation_end_time: e.target.value || null,
                        })
                      }
                      className="rounded-lg border border-stone-300 px-2 py-1"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min={1}
                      value={row.reservation_interval_minutes}
                      onChange={(e) =>
                        updateRow(index, {
                          reservation_interval_minutes: Number(e.target.value || 15),
                        })
                      }
                      className="w-20 rounded-lg border border-stone-300 px-2 py-1"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min={1}
                      value={row.default_stay_minutes}
                      onChange={(e) =>
                        updateRow(index, {
                          default_stay_minutes: Number(e.target.value || 120),
                        })
                      }
                      className="w-24 rounded-lg border border-stone-300 px-2 py-1"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {saving ? "保存中..." : "保存する"}
          </button>

          {message && <p className="text-sm text-stone-600">{message}</p>}
        </div>
      </div>
    </main>
  );
}
