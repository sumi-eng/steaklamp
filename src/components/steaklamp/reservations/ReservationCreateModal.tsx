"use client";

import { adminFetch } from "@/steaklamp/lib/adminClient";

import { useState } from "react";
import SeatPicker from "./SeatPicker";

type Props = {
  defaultDateKey: string;
  onClose: () => void;
  onCreated: () => void;
};

function toLocalDatetimeValue(dateKey: string) {
  return `${dateKey}T18:00`;
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


  // 選んだ席（先頭が代表席）。複数なら連結
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // 日時・滞在時間を変えたら、空きが変わるので席を選び直す
  function changeStartAt(value: string) {
    setStartAt(value);
    setSelectedSeatIds([]);
  }
  function changeDuration(value: number) {
    setDuration(value);
    setSelectedSeatIds([]);
  }

 async function handleCreate() {
  if (creating) return;

  if (selectedSeatIds.length === 0) {
    alert("席を選択してください");
    return;
  }

  setCreating(true);

  try {
    const send = (confirmCapacityMismatch: boolean) =>
      adminFetch("/api/steaklamp/reservations/create", {
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
          seatIds: selectedSeatIds,
          confirmCapacityMismatch,
          course_name_snapshot: courseName,
          course_price_snapshot: coursePrice,
          source: "admin",
        }),
      });

    let res = await send(false);
    let data = await res.json();

    // 席が足りない・取りすぎのときは、確認してから登録する
    if (data.error === "persons_out_of_range") {
      if (!confirm(`${data.detail}
このまま登録しますか？`)) return;
      res = await send(true);
      data = await res.json();
    }

    if (!res.ok) {
      alert(data.detail || data.error || "予約作成に失敗しました");
      return;
    }

    onCreated();
    onClose();
  } catch (e) {
    alert("予約作成に失敗しました");
  } finally {
    setCreating(false);
  }
}


  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
      <div className="flex min-h-full items-start justify-center py-6">
       <div className="relative w-full max-w-4xl rounded-3xl bg-white shadow-2xl">
  <div className="max-h-[90dvh] overflow-y-auto p-4 pb-28 md:p-6">

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
                    changeStartAt(`${e.target.value}T${timePart}`);
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
    changeStartAt(`${datePart}T${e.target.value}`);
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

              <div className="md:col-span-2">
                <SeatPicker
                  persons={persons}
                  startAt={startAt}
                  duration={duration}
                  value={selectedSeatIds}
                  onChange={setSelectedSeatIds}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-stone-800">時間</label>
                <select
                  value={String(duration)}
                  onChange={(e) => changeDuration(Number(e.target.value))}
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

      if (value === "Aコース") setCoursePrice(7200);
      else if (value === "Bコース") setCoursePrice(9800);
      else if (value === "Cコース") setCoursePrice(12000);
      else if (value === "クリスマスコース") setCoursePrice(11000);
      else setCoursePrice(null);
    }}
    className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-stone-500"
  >
    <option value="席のみ">席のみ</option>
    <option value="Aコース">Aコース 7,200円</option>
    <option value="Bコース">Bコース 9,800円</option>
    <option value="Cコース">Cコース 12,000円</option>
    <option value="クリスマスコース">クリスマスコース 11,000円</option>
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

                       <div className="sticky bottom-0 -mx-4 mt-8 grid grid-cols-2 gap-3 border-t border-stone-200 bg-white/95 px-4 py-4 md:-mx-6 md:px-6">
  <button
    type="button"
    onClick={onClose}
    disabled={creating}
    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-base font-bold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
  >
    閉じる
  </button>

  <button
    type="button"
    disabled={creating}
    onClick={handleCreate}
    className="w-full rounded-2xl bg-stone-900 px-4 py-3 text-base font-bold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
  >
    {creating ? "作成中..." : "予約を作成"}
  </button>
</div>
</div>
        </div>
      </div>
    </div>
  );
}
