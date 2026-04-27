"use client";

import { useEffect, useMemo, useState } from "react";

type Seat = {
  id: string;
  name: string;
  seat_type: "table" | "group";
  capacity_min: number;
  capacity_max: number;
  sort_order: number;
};

type Member = {
  id: string;
  group_seat_id: string;
  member_seat_id: string;
};

export default function SeatGroupsEditor() {
  const [seats, setSeats] = useState<Seat[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMessage("");

      try {
        const res = await fetch("/api/steaklamp/admin/seat-groups", {
          cache: "no-store",
        });
        const json = await res.json();

        if (json?.ok) {
          setSeats(json.seats ?? []);
          setMembers(json.members ?? []);
        } else {
          setMessage("読み込みに失敗しました。");
        }
      } catch {
        setMessage("読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const groupSeats = useMemo(
    () => seats.filter((s) => s.seat_type === "group"),
    [seats]
  );

  const tableSeats = useMemo(
    () => seats.filter((s) => s.seat_type === "table"),
    [seats]
  );

  const seatNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const seat of seats) {
      map.set(seat.id, seat.name);
    }
    return map;
  }, [seats]);

  const selectedGroup = useMemo(
    () => groupSeats.find((s) => s.id === selectedGroupId) ?? null,
    [groupSeats, selectedGroupId]
  );

  const selectedMemberNames = useMemo(() => {
    return checkedIds
      .map((id) => seatNameById.get(id))
      .filter(Boolean) as string[];
  }, [checkedIds, seatNameById]);

  const groupedSummary = useMemo(() => {
    return groupSeats.map((groupSeat) => {
      const memberNames = members
        .filter((m) => m.group_seat_id === groupSeat.id)
        .map((m) => seatNameById.get(m.member_seat_id))
        .filter(Boolean) as string[];

      return {
        groupId: groupSeat.id,
        groupName: groupSeat.name,
        members: memberNames,
      };
    });
  }, [groupSeats, members, seatNameById]);

  useEffect(() => {
    if (!selectedGroupId) {
      setCheckedIds([]);
      return;
    }

    const selected = members
      .filter((m) => m.group_seat_id === selectedGroupId)
      .map((m) => m.member_seat_id);

    setCheckedIds(selected);
  }, [selectedGroupId, members]);

  function toggleMember(id: string) {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    if (!selectedGroupId) {
      setMessage("連結席を選択してください。");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/steaklamp/admin/seat-groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          groupSeatId: selectedGroupId,
          memberSeatIds: checkedIds,
        }),
      });

      const json = await res.json();

      if (json?.ok) {
        setMembers(json.members ?? []);
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
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-stone-900">連結席設定</h1>
          <p className="mt-1 text-sm text-stone-600">steaklamp</p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-stone-700">
              連結席を選択
            </label>
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2"
            >
              <option value="">選択してください</option>
              {groupSeats.map((seat) => (
                <option key={seat.id} value={seat.id}>
                  {seat.name}
                </option>
              ))}
            </select>
          </div>

          {selectedGroup && (
            <div className="mb-4 rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <div className="font-medium text-stone-900">
                現在の構成: {selectedGroup.name}
              </div>
              <div className="mt-1">
                {selectedMemberNames.length > 0
                  ? selectedMemberNames.join(" / ")
                  : "まだ物理席が割り当てられていません"}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-sm font-medium text-stone-700">
              構成する物理席
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tableSeats.map((seat) => {
                const checked = checkedIds.includes(seat.id);

                return (
                  <label
                    key={seat.id}
                    className="flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMember(seat.id)}
                    />
                    <span className="text-sm text-stone-800">
                      {seat.name}（{seat.capacity_min}〜{seat.capacity_max}）
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
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

        <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-stone-900">連結席一覧</h2>

          <div className="space-y-3">
            {groupedSummary.map((row) => (
              <div
                key={row.groupId}
                className="rounded-xl border border-stone-200 px-4 py-3"
              >
                <div className="font-medium text-stone-900">{row.groupName}</div>
                <div className="mt-1 text-sm text-stone-700">
                  {row.members.length > 0
                    ? row.members.join(" / ")
                    : "未設定"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
