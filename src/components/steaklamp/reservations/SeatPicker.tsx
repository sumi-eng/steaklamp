"use client";

import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/steaklamp/lib/adminClient";
import { judgeLinkedCapacity } from "@/steaklamp/lib/inbound/seat-allocation";

// スタッフ用の席選び。
//  - 物理席（T1-1〜T3-2、C1〜C8）をタップして、いくつでも連結できる（先に選んだ席が代表席）
//  - 既存のグループ席（右テーブル、C-12 など）は「グループ席から選ぶ」から1つ選べる
// 選んだ席の合計定員を表示し、足りない・取りすぎのときは警告する（保存時にもう一度確認する）。

type PhysicalSeat = {
  id: string;
  name: string;
  kind: "table" | "counter";
  maxPersons: number;
  free: boolean;
  conflictWith: string | null;
};

type GroupCandidate = {
  id: string;
  name: string;
  capacityLabel: string;
  physicalSeats: string;
  kind?: "table" | "counter";
  free?: boolean;
  fitsPersons?: boolean;
  conflictWith?: string | null;
};

type Props = {
  persons: number;
  // 検索に使う開始日時（"2026-12-01T18:00:00+09:00" や "2026-12-01T18:00"）
  startAt: string;
  duration: number;
  // 変更中の予約自身が占有している席を、空きとして扱う
  excludeReservationId?: string;
  // 選択中の席ID（先頭が代表席）
  value: string[];
  onChange: (ids: string[]) => void;
  // 一覧にない席（無効にした席など）が選ばれているときの表示名
  currentSeatLabel?: string;
};

export default function SeatPicker({
  persons,
  startAt,
  duration,
  excludeReservationId,
  value,
  onChange,
  currentSeatLabel,
}: Props) {
  const [physical, setPhysical] = useState<PhysicalSeat[]>([]);
  const [groups, setGroups] = useState<GroupCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);

  // 人数・日時・滞在分数に合わせて、席の空き状況を自動で読み込む
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!startAt || !persons || !duration) return;
      setLoading(true);
      setError("");

      try {
        const res = await adminFetch("/api/steaklamp/seats/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persons,
            startAt,
            duration,
            counterOk: true,
            includeAll: true,
            excludeReservationId: excludeReservationId ?? undefined,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setError("席の空き状況を読み込めませんでした。");
          setPhysical([]);
          setGroups([]);
        } else {
          setPhysical(data.physical ?? []);
          setGroups(data.seats ?? []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setError("席の空き状況を読み込めませんでした。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timer = setTimeout(load, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [persons, startAt, duration, excludeReservationId]);

  const physicalById = useMemo(() => new Map(physical.map((p) => [p.id, p])), [physical]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  // グループ席（または一覧にない席）が選ばれているか。物理席だけの選択なら false
  const groupMode = loaded && value.length > 0 && value.some((id) => !physicalById.has(id));
  const group = groupMode && value.length === 1 ? groupById.get(value[0]) ?? null : null;
  const unknownCurrent = groupMode && value.length === 1 && !group;

  function toggle(id: string) {
    let next = groupMode ? [] : [...value];
    if (next.includes(id)) next = next.filter((x) => x !== id);
    else next.push(id);
    onChange(next);
  }

  const selectedPhysical = !groupMode ? value.map((id) => physicalById.get(id)).filter(Boolean) as PhysicalSeat[] : [];
  const totalMax = selectedPhysical.reduce((sum, p) => sum + p.maxPersons, 0);
  const issue = selectedPhysical.length > 0 ? judgeLinkedCapacity(persons, totalMax) : null;
  const conflicted = selectedPhysical.filter((p) => !p.free);

  const tables = physical.filter((p) => p.kind === "table");
  const counters = physical.filter((p) => p.kind === "counter");

  function chip(p: PhysicalSeat) {
    const selected = !groupMode && value.includes(p.id);
    const blocked = !p.free && !selected;
    const order = selected ? value.indexOf(p.id) + 1 : 0;
    return (
      <button
        key={p.id}
        type="button"
        disabled={blocked}
        onClick={() => toggle(p.id)}
        aria-pressed={selected}
        className={[
          "relative min-h-12 rounded-2xl border px-2 py-2 text-left text-sm font-bold transition",
          selected
            ? p.free
              ? "border-stone-900 bg-stone-900 text-white"
              : "border-red-600 bg-red-600 text-white"
            : blocked
              ? "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400"
              : "border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
        ].join(" ")}
      >
        <div>{p.name}</div>
        <div className="text-xs font-normal opacity-80">
          {blocked ? `予約済 ${p.conflictWith ?? ""}` : `${p.maxPersons}名`}
        </div>
        {selected && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-white/90 px-1.5 text-[10px] font-bold text-stone-900">
            {order === 1 ? "代表" : order}
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <div className="mb-1 text-sm font-bold text-stone-700">席（タップして連結できます）</div>

      {error && <div className="mb-2 text-xs font-bold text-red-600">{error}</div>}

      <div className="rounded-2xl border border-stone-200 p-3">
        <div className="mb-1 text-xs font-bold text-stone-500">テーブル席</div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{tables.map(chip)}</div>

        <div className="mb-1 mt-3 text-xs font-bold text-stone-500">カウンター席</div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">{counters.map(chip)}</div>

        {!loaded && <div className="mt-2 text-xs text-stone-500">{loading ? "席を読み込み中..." : ""}</div>}
      </div>

      {/* 選択中の席と合計定員 */}
      <div className="mt-2 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
        {value.length === 0 && <div>席が選ばれていません。</div>}

        {!groupMode && selectedPhysical.length > 0 && (
          <div>
            <span className="font-bold">選択中:</span> {selectedPhysical.map((p) => p.name).join("・")}
            <span className="ml-2 font-bold">合計定員 {totalMax}名</span>
            <span className="ml-2">/ 予約 {persons}名</span>
          </div>
        )}

        {group && (
          <div>
            <span className="font-bold">グループ席:</span> {group.name}（{group.capacityLabel}）
            <span className="ml-2 text-stone-500">{group.physicalSeats}</span>
          </div>
        )}

        {unknownCurrent && (
          <div>
            <span className="font-bold">現在の席:</span> {currentSeatLabel || "（一覧にない席）"}
          </div>
        )}

        {groupMode && value.length > 1 && (
          <div>
            <span className="font-bold">現在の席:</span> {currentSeatLabel || "連結した席"}
            <span className="ml-2 text-stone-500">（席を選び直すと置き換わります）</span>
          </div>
        )}
      </div>

      {issue === "short" && (
        <div className="mt-1 text-xs font-bold text-amber-600">
          席の定員が足りません（合計{totalMax}名・{persons}名）。保存時に確認が出ます。
        </div>
      )}
      {issue === "oversize" && (
        <div className="mt-1 text-xs font-bold text-amber-600">
          席を取りすぎです（合計{totalMax}名分・{persons}名）。ほかのお客様の席をふさぐ可能性があります。保存時に確認が出ます。
        </div>
      )}
      {group && group.free !== false && group.fitsPersons === false && (
        <div className="mt-1 text-xs font-bold text-amber-600">
          {persons}名には合わない席です（{group.capacityLabel}）。保存時に確認が出ます。
        </div>
      )}
      {(conflicted.length > 0 || (group && group.free === false)) && (
        <div className="mt-1 text-xs font-bold text-red-600">
          選んだ席に同じ時間帯の別の予約があるため、保存できません。
        </div>
      )}

      {/* 既存のグループ席 */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setGroupOpen((v) => !v)}
          className="text-sm font-bold text-stone-600 underline"
        >
          {groupOpen ? "▼" : "▶"} グループ席から選ぶ（右テーブル・C-12 など）
        </button>

        {groupOpen && (
          <select
            value={group ? group.id : ""}
            onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
            className="mt-2 w-full rounded-2xl border border-stone-300 px-4 py-3"
          >
            <option value="">グループ席を選択</option>
            {(["table", "counter"] as const).map((kind) => (
              <optgroup key={kind} label={kind === "table" ? "テーブル席" : "カウンター席"}>
                {groups
                  .filter((g) => (g.kind ?? "table") === kind)
                  .map((g) => {
                    const blocked = g.free === false;
                    const label = [
                      g.name,
                      `（${g.capacityLabel}）`,
                      g.physicalSeats !== g.name ? ` ${g.physicalSeats}` : "",
                      blocked ? ` ×予約済み（${g.conflictWith}様）` : "",
                      !blocked && g.fitsPersons === false ? " ⚠定員外" : "",
                    ].join("");
                    return (
                      <option key={g.id} value={g.id} disabled={blocked && !(group && group.id === g.id)}>
                        {label}
                      </option>
                    );
                  })}
              </optgroup>
            ))}
          </select>
        )}
      </div>

      <div className="mt-1 text-xs text-stone-500">
        {loading
          ? "席の空き状況を読み込み中..."
          : "同じ時間帯に空いている席を選べます。予約済みの席は選べません。先に選んだ席が代表席になります。"}
      </div>
    </div>
  );
}
