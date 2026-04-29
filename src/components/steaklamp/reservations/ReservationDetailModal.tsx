"use client";

import { useEffect, useState } from "react";

type SeatCandidate = {
  id: string;
  name: string;
  capacityLabel: string;
  physicalSeats: string;
};

type ReservationDetail = {
  id: string;
  seatId: string;
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
  const [seatId, setSeatId] = useState(reservation.seatId);

const [courseName, setCourseName] = useState(
  reservation.courseNameSnapshot ?? "席のみ"
);

const [coursePrice, setCoursePrice] = useState<number | null>(
  reservation.coursePriceSnapshot ?? null
);


  const [candidates, setCandidates] = useState<SeatCandidate[]>([]);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function loadSeatCandidates() {
    setLoadingSeats(true);

    try {
      const res = await fetch("/api/steaklamp/seats/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persons,
          startAt: `${startAt}:00+09:00`,
          duration: durationMinutes,
          counterOk: true,
        }),
      });

      const data = await res.json();

      const loaded: SeatCandidate[] = data.ok ? data.seats ?? [] : [];

      const existsCurrent = loaded.some((s) => s.id === reservation.seatId);

      if (!existsCurrent) {
        loaded.unshift({
          id: reservation.seatId,
          name: reservation.seatName,
          capacityLabel: "現在の席",
          physicalSeats: reservation.seatName,
        });
      }

      setCandidates(loaded);
    } finally {
      setLoadingSeats(false);
    }
  }

  useEffect(() => {
    setCandidates([]);
  }, [persons, startAt, durationMinutes]);

  async function handleUpdate() {
    setSaving(true);

    try {
      const res = await fetch("/api/steaklamp/reservations/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reservation.id,
          seatId,
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

      const data = await res.json();

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
      const res = await fetch("/api/steaklamp/reservations/delete", {
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

      if (value === "Aコース") setCoursePrice(6600);
      else if (value === "Bコース") setCoursePrice(8800);
      else if (value === "Cコース") setCoursePrice(11000);
      else setCoursePrice(null);
    }}
    className="w-full rounded-2xl border border-stone-300 px-4 py-3"
  >
    <option value="席のみ">席のみ</option>
    <option value="Aコース">Aコース 6,600円</option>
    <option value="Bコース">Bコース 8,800円</option>
    <option value="Cコース">Cコース 11,000円</option>
  </select>
</label>

            </div>

            <div className="mt-4">
              <div className="mb-1 text-sm font-bold text-stone-700">席</div>
              <select
                value={seatId}
                onFocus={loadSeatCandidates}
                onClick={loadSeatCandidates}
                onChange={(e) => setSeatId(e.target.value)}
                className="w-full rounded-2xl border border-stone-300 px-4 py-3"
              >
                <option value={reservation.seatId}>
                  {reservation.seatName}（現在）
                </option>

                {candidates
                  .filter((s) => s.id !== reservation.seatId)
                  .map((seat) => (
                    <option key={seat.id} value={seat.id}>
                      {seat.name}（{seat.capacityLabel}） {seat.physicalSeats}
                    </option>
                  ))}
              </select>

              <div className="mt-1 text-xs text-stone-500">
                {loadingSeats
                  ? "候補席を読み込み中..."
                  : "人数・日時・滞在分数に合う席候補が表示されます。"}
              </div>
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
