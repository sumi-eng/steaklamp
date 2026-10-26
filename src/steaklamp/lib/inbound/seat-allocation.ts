// 取り込みメール(ホットペッパー・一休)の席割り当てロジック。DBに依存しない純粋関数にして、テストできるようにしている。

export type SeatRow = {
  id: string;
  name: string;
  min_persons?: number | null;
  max_persons?: number | null;
  capacity_min?: number | null;
  capacity_max?: number | null;
  is_active?: boolean | null;
  is_reservable?: boolean | null;
  sort_order?: number | null;
};

export type SeatMemberRow = {
  group_seat_id: string;
  member_seat_id: string;
};

export type ReservationRow = {
  id?: string | null;
  seat_id?: string | null;
  start_at?: string | null;
  duration_minutes?: number | null;
  status?: string | null;
  name?: string | null;
};

// 席を割り当てられなかった実際の理由
//  - counter_only: その人数で座れる席がカウンターしかないが、カウンター不可の予約
//  - capacity:     人数に合う席が(席マスタ上)存在しない
//  - full:         人数に合う席はあるが、その時間帯は埋まっている
export type NoSeatReason = "counter_only" | "capacity" | "full";

export type SeatChoice = {
  seat: SeatRow | null;
  reason: NoSeatReason | null;
  // 変更メールで、元の席をそのまま維持した場合 true
  keptExisting: boolean;
  // 元の席を維持したが、人数が席の定員の範囲外のとき true（スタッフが手動で入れた席を守るため）
  capacityMismatch?: boolean;
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export function minCap(seat: SeatRow) {
  return Number(seat.min_persons ?? seat.capacity_min ?? 1);
}

export function maxCap(seat: SeatRow) {
  return Number(seat.max_persons ?? seat.capacity_max ?? 99);
}

export function isPhysicalTableSeat(name: string) {
  return /^T\d+-\d+$/.test(name);
}

export function isCounterSeat(name: string) {
  return /^C\d+$/.test(name);
}

export function isCounterGroupSeat(name: string) {
  return /^C-\d+/.test(name);
}

function isSixTableSeatName(name: string) {
  return name === "右6名席" || name === "左6名席";
}

export function expandPhysicalSeatIds(seatId: string, members: SeatMemberRow[]) {
  const childIds = members
    .filter((m) => String(m.group_seat_id) === String(seatId))
    .map((m) => String(m.member_seat_id));

  return new Set(childIds.length > 0 ? childIds : [String(seatId)]);
}

function hasSeatConflict(a: Set<string>, b: Set<string>) {
  for (const id of a) {
    if (b.has(id)) return true;
  }
  return false;
}

export function chooseSeat(args: {
  seats: SeatRow[];
  members: SeatMemberRow[];
  reservations: ReservationRow[];
  persons: number;
  startAt: Date;
  duration: number;
  counterOk: boolean;
  // メールの席情報から読み取った席種。"counter" のときはカウンター席の中から選ぶ。
  seatKind?: "counter" | "table" | "unknown";
  // 変更メールで、自分自身の予約が占有している席を空きとして扱う
  excludeReservationId?: string | null;
  // 変更メールで、元の席が新しい日時・人数でも空いていれば維持する
  preferSeatId?: string | null;
}): SeatChoice {
  const { members, reservations, persons, startAt, duration, counterOk } = args;
  const { excludeReservationId, preferSeatId } = args;
  const endAt = addMinutes(startAt, duration);

  const seats = args.seats
    .filter((s) => s.is_active !== false)
    .filter((s) => s.is_reservable !== false)
    .sort((a, b) => {
      const ao = Number(a.sort_order ?? 9999);
      const bo = Number(b.sort_order ?? 9999);
      if (ao !== bo) return ao - bo;
      return String(a.name).localeCompare(String(b.name), "ja");
    });

  const occupiedPhysicalSeatIds = new Set<string>();

  for (const r of reservations) {
    if (!r.seat_id || !r.start_at) continue;
    if (excludeReservationId && String(r.id) === String(excludeReservationId)) continue;
    if (["cancelled", "finished", "no_show"].includes(String(r.status))) continue;

    const rStart = new Date(r.start_at);
    const rEnd = addMinutes(rStart, Number(r.duration_minutes ?? 120));

    if (!overlaps(startAt, endAt, rStart, rEnd)) continue;

    for (const id of expandPhysicalSeatIds(String(r.seat_id), members)) {
      occupiedPhysicalSeatIds.add(id);
    }
  }

  const fitsPersons = (seat: SeatRow) => persons >= minCap(seat) && persons <= maxCap(seat);

  const isFree = (seat: SeatRow) =>
    !hasSeatConflict(expandPhysicalSeatIds(String(seat.id), members), occupiedPhysicalSeatIds);

  // 元の席がその時間帯に空いていればそのまま維持する。
  // 人数が席の定員から外れていても、スタッフが手動で入れた席の可能性があるため維持する（警告は呼び出し側で出す）
  if (preferSeatId) {
    const preferred = seats.find((s) => String(s.id) === String(preferSeatId));
    if (preferred && isFree(preferred)) {
      return { seat: preferred, reason: null, keptExisting: true, capacityMismatch: !fitsPersons(preferred) };
    }
  }

  const typeAllowed = (seat: SeatRow, allowCounter: boolean) => {
    const seatName = String(seat.name ?? "");

    if (isPhysicalTableSeat(seatName)) return false;
    // 席情報が「カウンター」の予約は、テーブル席ではなくカウンター席に割り当てる
    if (args.seatKind === "counter" && !(isCounterSeat(seatName) || isCounterGroupSeat(seatName))) {
      return false;
    }
    if (!allowCounter && (isCounterSeat(seatName) || isCounterGroupSeat(seatName))) return false;
    if (persons <= 1 && isCounterGroupSeat(seatName)) return false;

    // 6名以上は6名席を候補から外して、8名席・全テーブル側に寄せる
    if (persons >= 6 && isSixTableSeatName(seatName)) return false;

    return true;
  };

  const candidates = seats.filter((seat) => typeAllowed(seat, counterOk) && fitsPersons(seat));
  const free = candidates.find(isFree);

  if (free) return { seat: free, reason: null, keptExisting: false };

  let reason: NoSeatReason;
  if (candidates.length > 0) {
    reason = "full";
  } else if (!counterOk && seats.some((seat) => typeAllowed(seat, true) && fitsPersons(seat))) {
    reason = "counter_only";
  } else {
    reason = "capacity";
  }

  return { seat: null, reason, keptExisting: false };
}

// 席を割り当てられなかったときの、現場向けの警告文
export function noSeatMessage(args: {
  reason: NoSeatReason;
  persons: number;
  counterOk: boolean;
  seatKind?: "counter" | "table" | "unknown";
  sourceLabel: string;
}) {
  const { reason, persons, counterOk, seatKind, sourceLabel } = args;
  const head = `${sourceLabel}からの予約ですが、`;

  if (reason === "counter_only") {
    return `${head}${persons}名様が座れる席はカウンター席のみです。カウンターで案内できるか確認してください。`;
  }

  if (reason === "capacity") {
    return `${head}${persons}名様に合う席がありません。手動で席を確認してください。`;
  }

  if (!counterOk) {
    return `${head}${persons}名様のテーブル席に空きがありません。カウンターへの変更が可能か確認してください。`;
  }

  if (persons <= 1) {
    return `${head}1名で座れるカウンター席に空きがありません。手動で席を確認してください。`;
  }

  return seatKind === "counter"
    ? `${head}${persons}名様のカウンター席に空きがありません。手動で席を確認してください。`
    : `${head}${persons}名様の席（カウンター含む）に空きがありません。手動で席を確認してください。`;
}

// 元の席を維持したが人数が定員の範囲外のときの、現場向けの警告文
export function capacityMismatchMessage(args: {
  seat: SeatRow;
  persons: number;
  sourceLabel: string;
}) {
  const { seat, persons, sourceLabel } = args;
  return `${sourceLabel}の変更で人数が${persons}名になりましたが、席「${seat.name}」（${minCap(seat)}〜${maxCap(seat)}名）のままです。席を確認してください。`;
}

// 予約の席を手動で選んだときの判定。人数が席の定員に合うかと、他の予約との重なりを返す。
export function evaluateSeatAssignment(args: {
  seat: SeatRow;
  members: SeatMemberRow[];
  reservations: ReservationRow[];
  persons: number;
  startAt: Date;
  duration: number;
  excludeReservationId?: string | null;
}) {
  const { seat, members, reservations, persons, startAt, duration, excludeReservationId } = args;
  const endAt = addMinutes(startAt, duration);
  const target = expandPhysicalSeatIds(String(seat.id), members);

  const conflicts = reservations.filter((r) => {
    if (!r.seat_id || !r.start_at) return false;
    if (excludeReservationId && String(r.id) === String(excludeReservationId)) return false;
    if (["cancelled", "finished", "no_show"].includes(String(r.status))) return false;

    const rStart = new Date(r.start_at);
    const rEnd = addMinutes(rStart, Number(r.duration_minutes ?? 120));
    if (!overlaps(startAt, endAt, rStart, rEnd)) return false;

    return hasSeatConflict(target, expandPhysicalSeatIds(String(r.seat_id), members));
  });

  return {
    fitsPersons: persons >= minCap(seat) && persons <= maxCap(seat),
    conflicts,
  };
}
