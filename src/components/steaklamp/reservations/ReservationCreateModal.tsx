"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  defaultDateKey: string;
  onClose: () => void;
  onCreated: () => void;
};

type CandidateSeat = {
  id: string;
  name: string;
  capacityLabel: string;
  physicalSeats: string;
};

function toLocalDatetimeValue(dateKey: string) {
  return `${dateKey}T18:00`;
}

function formatSeatLabel(seat: CandidateSeat) {
  return `${seat.name}（${seat.capacityLabel}）`;
}

export default function ReservationCreateModal({
  defaultDateKey,
  onClose,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [persons, setPersons] = useState(2);
  const [startAt, setStartAt] = useState(toLocalDatetimeValue(defaultDateKey));
  const [duration, setDuration] = useState(120);
  const [notes, setNotes] = useState("");
  const [counterOk, setCounterOk] = useState(false);

const [courseName, setCourseName] = useState("席のみ");
const [coursePrice, setCoursePrice] = useState<number | null>(null);


  const [candidates, setCandidates] = useState<CandidateSeat[]>([]);
  const [selectedSeatId, setSelectedSeatId] = useState("");
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [seatMessage, setSeatMessage] = useState("");

  const canSearchSeats = useMemo(() => {
    return persons > 0 && !!startAt && duration > 0;
  }, [persons, startAt, duration]);

 useEffect(() => {
  setSelectedSeatId("");
  setCandidates([]);
  setSeatMessage("");
}, [persons, startAt, duration, counterOk]);

  async function loadSeatCandidates() {
    if (!canSearchSeats) {
      setCandidates([]);
      setSeatMessage("先に日時・人数・滞在時間を入力してください。");
      return;
    }

    setLoadingSeats(true);
    setSeatMessage("");

    try {
      const res = await fetch("/api/steaklamp/seats/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          persons,
          startAt,
          duration,
          counterOk,
        }),
      });

      const data = await res.json();
      const seats = data.seats || [];

      setCandidates(seats);

      if (seats.length === 0) {
        setSeatMessage("条件に合う候補席がありません。");
      }
    } catch (e) {
      setCandidates([]);
      setSeatMessage("候補席の取得に失敗しました。");
    } finally {
      setLoadingSeats(false);
    }
  }

  async function handleCreate() {
    if (!selectedSeatId) {
      alert("席を選択してください");
      return;
    }

    try {
      const res = await fetch("/api/steaklamp/reservations/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
       body: JSON.stringify({
  name,
  phone,
  email,
  persons,
  startAt,
  duration,
  notes,
  counterOk,
  seatId: selectedSeatId,
  course_name_snapshot: courseName,
  course_price_snapshot: coursePrice,
}),

      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "予約作成に失敗しました");
        return;
      }

      onCreated();
      onClose();
    } catch (e) {
      alert("予約作成に失敗しました");
    }
  }

  const selectedSeat = candidates.find((seat) => seat.id === selectedSeatId) || null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
      <div className="flex min-h-full items-start justify-center py-6">
        <div className="w-full max-w-4xl rounded-3xl bg-white shadow-2xl">
          <div className="max-h-[85vh] overflow-y-auto p-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-stone-900">予約追加</h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-3 py-1 text-sm text-stone-500 hover:bg-stone-100"
              >
                ✕
              </button>
            </div>

            <div className="mb-6 text-lg font-semibold text-stone-600">
              {defaultDateKey.replaceAll("-", "/")}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-bold text-stone-800">日付</label>
                <input
                  type="date"
                  value={startAt.slice(0, 10)}
                  onChange={(e) => {
                    const timePart = startAt.slice(11, 16) || "18:00";
                    setStartAt(`${e.target.value}T${timePart}`);
                  }}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 outline-none focus:border-stone-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-stone-800">開始時刻</label>
               <select
  value={startAt.slice(11, 16)}
  onChange={(e) => {
    const datePart = startAt.slice(0, 10);
    setStartAt(`${datePart}T${e.target.value}`);
  }}
  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-stone-500"
>
  {[
    "18:00",
    "18:15",
    "18:30",
    "18:45",
    "19:00",
    "19:15",
    "19:30",
    "19:45",
    "20:00",
  ].map((t) => (
    <option key={t} value={t}>
      {t}
    </option>
  ))}
</select>

              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-stone-800">席</label>
                <select
                  value={selectedSeatId}
                  onChange={(e) => setSelectedSeatId(e.target.value)}
                  onFocus={() => {
  loadSeatCandidates();
}}
onClick={() => {
  loadSeatCandidates();
}}

                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-stone-500"
                >
                  <option value="">
                    {loadingSeats
                      ? "候補席を読み込み中..."
                      : candidates.length > 0
                      ? "候補席を選択してください"
                      : "席を選択"}
                  </option>

                  {candidates.map((seat) => (
                    <option key={seat.id} value={seat.id}>
                      {formatSeatLabel(seat)}
                    </option>
                  ))}
                </select>

                <div className="mt-2 text-sm text-stone-500">
                  入店中・重複予約のある席は候補から除外しています。
                </div>

                {seatMessage && (
                  <div className="mt-2 text-sm text-amber-700">{seatMessage}</div>
                )}

                {selectedSeat && (
                  <div className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
                    <div>
                      <span className="font-semibold">物理席:</span>{" "}
                      {selectedSeat.physicalSeats}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-stone-800">時間</label>
                <select
                  value={String(duration)}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-stone-500"
                >
                  <option value="90">90分</option>
                  <option value="120">120分</option>
                  <option value="150">150分</option>
                  <option value="180">180分</option>
                </select>
              </div>

<div>
  <label className="mb-2 block text-sm font-bold text-stone-800">コース</label>
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
    className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-stone-500"
  >
    <option value="席のみ">席のみ</option>
    <option value="Aコース">Aコース 6,600円</option>
    <option value="Bコース">Bコース 8,800円</option>
    <option value="Cコース">Cコース 11,000円</option>
  </select>
</div>


              <div>
                <label className="mb-2 block text-sm font-bold text-stone-800">人数</label>
                <select
                  value={String(persons)}
                  onChange={(e) => setPersons(Number(e.target.value))}
                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-stone-500"
                >
                  {Array.from({ length: 12 }).map((_, i) => {
                    const n = i + 1;
                    return (
                      <option key={n} value={n}>
                        {n}名
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-stone-800">電話</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="09012345678"
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 outline-none focus:border-stone-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-stone-800">名前</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例) 山田 太郎"
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 outline-none focus:border-stone-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-stone-800">メール</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@example.com"
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 outline-none focus:border-stone-500"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700">
                <input
                  type="checkbox"
                  checked={counterOk}
                  onChange={(e) => setCounterOk(e.target.checked)}
                />
                カウンター席でも可
              </label>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-bold text-stone-800">備考</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ご要望があれば入力"
                rows={4}
                className="w-full rounded-2xl border border-stone-300 px-4 py-3 outline-none focus:border-stone-500"
              />
            </div>

            <div className="mt-8 flex items-center justify-end gap-4">
              <button
                type="button"
                onClick={onClose}
                className="min-w-[180px] rounded-2xl border border-stone-300 px-6 py-3 text-lg font-semibold text-stone-700 hover:bg-stone-100"
              >
                閉じる
              </button>

              <button
                type="button"
                onClick={handleCreate}
                className="min-w-[260px] rounded-2xl bg-stone-900 px-6 py-3 text-lg font-semibold text-white hover:bg-stone-800"
              >
                予約を作成
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
