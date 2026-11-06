"use client";

import { adminFetch } from "@/steaklamp/lib/adminClient";

import { useState } from "react";
import SeatPicker from "./SeatPicker";

type ReservationDetail = {
  id: string;
  seatId: string;
  // 連結した席すべて（先頭が代表席）。なければ seatId だけ
  seatIds?: string[];
  title: string;
  name?: string;
  phone?: string | null;
  email?: string | null;
  persons: number;
  startAt: string;
  durationMinutes: number;
  notes?: string | null;
  seatName: string;

  courseNameSnapshot?: string | null;
  coursePriceSnapshot?: number | null;
};

function toLocalDatetimeInputValue(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");

  return `${y}-${m}-${day}T${h}:${min}`;
}

export default function ReservationDetailModal({
  reservation,
  onClose,
  onUpdated,
}: {
  reservation: ReservationDetail;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(reservation.name ?? reservation.title ?? "");
  const [phone, setPhone] = useState(reservation.phone ?? "");
  const [email, setEmail] = useState(reservation.email ?? "");
  const [persons, setPersons] = useState(reservation.persons);
  const [startAt, setStartAt] = useState(
    toLocalDatetimeInputValue(reservation.startAt)
  );
  const [durationMinutes, setDurationMinutes] = useState(
    reservation.durationMinutes
  );
  const [notes, setNotes] = useState(reservation.notes ?? "");
  const [seatIds, setSeatIds] = useState<string[]>(
    reservation.seatIds && reservation.seatIds.length > 0
      ? reservation.seatIds
      : reservation.seatId
        ? [reservation.seatId]
        : []
  );

const [courseName, setCourseName] = useState(
  reservation.courseNameSnapshot ?? "席のみ"
);

const [coursePrice, setCoursePrice] = useState<number | null>(
  reservation.coursePriceSnapshot ?? null
);


  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleUpdate() {
    if (seatIds.length === 0) {
      alert("席を選んでください");
      return;
    }

    // 人数に合わない席・席の取りすぎは、サーバーが判定し、確認したうえで変更できる
    let confirmCapacityMismatch = false;

    setSaving(true);

    try {
      const send = () => adminFetch("/api/steaklamp/reservations/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reservation.id,
          seatIds,
          confirmCapacityMismatch,
          name,
          phone,
          email,
          persons,
          startAt: `${startAt}:00+09:00`,
          durationMinutes,
          notes,
course_name_snapshot: courseName,
course_price_snapshot: coursePrice,

        }),
      });

      let res = await send();
      let data = await res.json();

      // 人数が席の定員から外れる・席を取りすぎのときは、確認してから保存する
      if (data.error === "persons_out_of_range") {
        if (!confirm(`${data.detail}
このまま変更しますか？`)) return;
        confirmCapacityMismatch = true;
        res = await send();
        data = await res.json();
      }

      if (!res.ok || !data.ok) {
        alert(data.detail || data.error || "変更に失敗しました");
        return;
      }

      onUpdated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("この予約を削除しますか？")) return;

    setDeleting(true);

    try {
      const res = await adminFetch("/api/steaklamp/reservations/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reservation.id }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        alert(data.detail || data.error || "削除に失敗しました");
        return;
      }

      onUpdated();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
      <div className="flex min-h-full items-start justify-center py-6">
        <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
          <div className="max-h-[85vh] overflow-y-auto p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-stone-900">予約詳細</h2>
                <div className="mt-1 text-sm text-stone-500">
                  現在：{reservation.seatName}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-3 py-1 text-sm text-stone-500 hover:bg-stone-100"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label>
                <div className="mb-1 text-sm font-bold text-stone-700">名前</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3"
                />
              </label>

              <label>
                <div className="mb-1 text-sm font-bold text-stone-700">電話</div>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3"
                />
              </label>

              <label>
                <div className="mb-1 text-sm font-bold text-stone-700">メール</div>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3"
                />
              </label>

              <label>
                <div className="mb-1 text-sm font-bold text-stone-700">人数</div>
                <input
                  type="number"
                  min={1}
                  value={persons}
                  onChange={(e) => setPersons(Number(e.target.value))}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3"
                />
              </label>

              <label>
                <div className="mb-1 text-sm font-bold text-stone-700">開始日時</div>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3"
                />
              </label>

              <label>
                <div className="mb-1 text-sm font-bold text-stone-700">滞在分数</div>
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3"
                />
              </label>

<label>
  <div className="mb-1 text-sm font-bold text-stone-700">コース</div>
  <select
    value={courseName}
    onChange={(e) => {
      const value = e.target.value;
      setCourseName(value);

      if (value === "Aコース") setCoursePrice(7200);
      else if (value === "Bコース") setCoursePrice(9800);
      else if (value === "Cコース") setCoursePrice(12000);
      else if (value === "クリスマスコース") setCoursePrice(11000);
      else setCoursePrice(null);
    }}
    className="w-full rounded-2xl border border-stone-300 px-4 py-3"
  >
    <option value="席のみ">席のみ</option>
    <option value="Aコース">Aコース 7,200円</option>
    <option value="Bコース">Bコース 9,800円</option>
    <option value="Cコース">Cコース 12,000円</option>
    <option value="クリスマスコース">クリスマスコース 11,000円</option>
  </select>
</label>

            </div>

            <div className="mt-4">
              <SeatPicker
                persons={persons}
                startAt={`${startAt}:00+09:00`}
                duration={durationMinutes}
                excludeReservationId={reservation.id}
                value={seatIds}
                onChange={setSeatIds}
                currentSeatLabel={reservation.seatName}
              />
            </div>

            <label className="mt-4 block">
              <div className="mb-1 text-sm font-bold text-stone-700">備考</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full rounded-2xl border border-stone-300 px-4 py-3"
              />
            </label>

            <div className="mt-6 flex justify-between gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {deleting ? "削除中..." : "削除"}
              </button>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-bold text-stone-700"
                >
                  閉じる
                </button>

                <button
                  type="button"
                  onClick={handleUpdate}
                  disabled={saving}
                  className="rounded-2xl bg-stone-900 px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {saving ? "変更中..." : "変更"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
