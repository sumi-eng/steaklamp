"use client";

import { useEffect, useState } from "react";

type Row = {
  id?: string;
  name: string;
  zone: string;
  seat_type: "table" | "group";
  capacity_min: number;
  capacity_max: number;
  is_active: boolean;
  is_reservable: boolean;
  sort_order: number;
};

const EMPTY_ROW: Row = {
  name: "",
  zone: "hall",
  seat_type: "table",
  capacity_min: 1,
  capacity_max: 1,
  is_active: true,
  is_reservable: true,
  sort_order: 0,
};

export default function SeatsEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMessage("");

      try {
        const res = await fetch("/api/steaklamp/admin/seats", {
          cache: "no-store",
        });
        const json = await res.json();

        if (json?.ok) {
          setRows(json.rows ?? []);
        } else {
          setMessage(json?.detail || "読み込みに失敗しました。");
        }
      } catch {
        setMessage("読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { ...EMPTY_ROW, sort_order: prev.length + 1 },
    ]);
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/steaklamp/admin/seats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rows }),
      });

      const json = await res.json();

      if (json?.ok) {
        setRows(json.rows ?? []);
        setMessage("保存しました。");
      } else {
        setMessage(json?.detail || "保存に失敗しました。");
      }
    } catch {
      setMessage("通信エラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="p-6">読み込み中...</main>;
  }

  return (
    <main className="min-h-screen bg-stone-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">席設定</h1>
            <p className="mt-1 text-sm text-stone-600">steaklamp</p>
          </div>

          <button
            type="button"
            onClick={addRow}
            className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white"
          >
            席を追加
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-stone-100">
              <tr>
                <th className="px-3 py-3 text-left">席名</th>
                <th className="px-3 py-3 text-left">ゾーン</th>
                <th className="px-3 py-3 text-left">種別</th>
                <th className="px-3 py-3 text-left">最小人数</th>
                <th className="px-3 py-3 text-left">最大人数</th>
                <th className="px-3 py-3 text-left">有効</th>
                <th className="px-3 py-3 text-left">予約可</th>
                <th className="px-3 py-3 text-left">並び順</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id ?? `new-${index}`} className="border-t border-stone-200">
                  <td className="px-3 py-3">
                    <input
                      value={row.name}
                      onChange={(e) => updateRow(index, { name: e.target.value })}
                      className="w-full rounded border border-stone-300 px-2 py-1"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <select
                      value={row.zone}
                      onChange={(e) => updateRow(index, { zone: e.target.value })}
                      className="rounded border border-stone-300 px-2 py-1"
                    >
                      <option value="hall">hall</option>
                      <option value="counter">counter</option>
                    </select>
                  </td>

                  <td className="px-3 py-3">
                    <select
                      value={row.seat_type}
                      onChange={(e) =>
                        updateRow(index, {
                          seat_type: e.target.value as "table" | "group",
                        })
                      }
                      className="rounded border border-stone-300 px-2 py-1"
                    >
                      <option value="table">table</option>
                      <option value="group">group</option>
                    </select>
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min={1}
                      value={row.capacity_min}
                      onChange={(e) =>
                        updateRow(index, { capacity_min: Number(e.target.value || 1) })
                      }
                      className="w-20 rounded border border-stone-300 px-2 py-1"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min={1}
                      value={row.capacity_max}
                      onChange={(e) =>
                        updateRow(index, { capacity_max: Number(e.target.value || 1) })
                      }
                      className="w-20 rounded border border-stone-300 px-2 py-1"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={(e) => updateRow(index, { is_active: e.target.checked })}
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={row.is_reservable}
                      onChange={(e) =>
                        updateRow(index, { is_reservable: e.target.checked })
                      }
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min={0}
                      value={row.sort_order}
                      onChange={(e) =>
                        updateRow(index, { sort_order: Number(e.target.value || 0) })
                      }
                      className="w-20 rounded border border-stone-300 px-2 py-1"
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
            className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white"
          >
            {saving ? "保存中..." : "保存する"}
          </button>

          {message && <div className="text-sm text-stone-600">{message}</div>}
        </div>
      </div>
    </main>
  );
}
