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

// 予約ID -> 自由連結した席ID(reservation_seats)。連結のない予約はキーを持たない。
export type SeatLinkMap = Map<string, string[]>;

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
  // 連結した席を維持した場合の、すべての席ID(先頭が代表席)。単独の席なら undefined
  keptSeatIds?: string[];
  // 通知・表示用の席名(連結なら「T1-1・T1-2・C3」)
  seatLabel?: string;
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

// ===== 自由連結(reservation_seats)の判定 =====

// 予約が使っている席ID(先頭が代表席=reservations.seat_id)。
// 連結の行は「代表席を含み、2席以上あるとき」だけ有効とみなす。
// 古い連結の行が残っていても、代表席が変わっていれば無視されるため、席が埋まったままにならない。
export function effectiveSeatIds(
  r: { id?: string | null; seat_id?: string | null },
  links?: SeatLinkMap
): string[] {
  const seatId = r.seat_id ? String(r.seat_id) : null;
  if (!seatId) return [];
  const linked = r.id ? links?.get(String(r.id)) : undefined;
  if (linked && linked.length > 1 && linked.map(String).includes(seatId)) {
    return [seatId, ...Array.from(new Set(linked.map(String))).filter((id) => id !== seatId)];
  }
  return [seatId];
}

// 席ID(グループ席を含む)の並びを、実際に使う物理席IDにまとめて展開する
export function physicalIdsOf(seatIds: string[], members: SeatMemberRow[]) {
  const out = new Set<string>();
  for (const id of seatIds) {
    for (const p of expandPhysicalSeatIds(String(id), members)) out.add(p);
  }
  return out;
}

// 予約が占有している物理席ID(連結・グループ席・単独席のすべてに対応)
export function reservationPhysicalSeatIds(
  r: { id?: string | null; seat_id?: string | null },
  members: SeatMemberRow[],
  links?: SeatLinkMap
) {
  return physicalIdsOf(effectiveSeatIds(r, links), members);
}

// 受け取った席IDの配列を、文字列・重複なしに整える
export function normalizeSeatIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const id = String(v ?? "").trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function sameSeatSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const bs = new Set(b.map(String));
  return a.every((id) => bs.has(String(id)));
}

export type CapacityIssue = "short" | "oversize" | null;

// 連結した席の合計定員と人数の釣り合い。
//  - short:    人数より席の定員が少ない
//  - oversize: 席を取りすぎ(例: 2名で18名分)。他のお客様の席をふさぐので確認する。
//              4名でテーブル3つ(6名分)のような少しの余裕は警告しない。
export function judgeLinkedCapacity(persons: number, totalMax: number): CapacityIssue {
  if (persons > totalMax) return "short";
  if (totalMax > persons * 2 && totalMax - persons >= 4) return "oversize";
  return null;
}

// 席名を並び順(sort_order→名前)で「T1-1・T1-2・C3」の形にする
export function seatLabelOf(seatIds: string[], seats: SeatRow[]) {
  const byId = new Map(seats.map((s) => [String(s.id), s]));
  return seatIds
    .map((id) => byId.get(String(id)))
    .filter((s): s is SeatRow => Boolean(s))
    .sort((a, b) => {
      const ao = Number(a.sort_order ?? 9999);
      const bo = Number(b.sort_order ?? 9999);
      if (ao !== bo) return ao - bo;
      return String(a.name).localeCompare(String(b.name), "ja");
    })
    .map((s) => s.name)
    .join("・");
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
  // 連結した席を持つ予約の変更では、連結したすべての席(先頭が代表席)。2席以上なら全部空いているときだけ維持する
  preferSeatIds?: string[] | null;
  // 他の予約の自由連結(reservation_seats)
  seatLinks?: SeatLinkMap;
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

    for (const id of reservationPhysicalSeatIds(r, members, args.seatLinks)) {
      occupiedPhysicalSeatIds.add(id);
    }
  }

  const fitsPersons = (seat: SeatRow) => persons >= minCap(seat) && persons <= maxCap(seat);

  const isFree = (seat: SeatRow) =>
    !hasSeatConflict(expandPhysicalSeatIds(String(seat.id), members), occupiedPhysicalSeatIds);

  // 元の席がその時間帯に空いていればそのまま維持する。
  // 人数が席の定員から外れていても、スタッフが手動で入れた席の可能性があるため維持する（警告は呼び出し側で出す）
  const preferIds = args.preferSeatIds?.length
    ? args.preferSeatIds.map(String)
    : preferSeatId
      ? [String(preferSeatId)]
      : [];

  // 連結した席は、連結したすべての席が空いているときだけ維持する(1席でも埋まっていれば選び直す)
  if (preferIds.length > 1) {
    const active = args.seats.filter((s) => s.is_active !== false);
    const rep = active.find((s) => String(s.id) === preferIds[0]);
    const allExist = preferIds.every((id) => active.some((s) => String(s.id) === id));
    const physical = physicalIdsOf(preferIds, members);
    if (rep && allExist && !hasSeatConflict(physical, occupiedPhysicalSeatIds)) {
      let totalMax = 0;
      for (const pid of physical) {
        const ps = args.seats.find((s) => String(s.id) === pid);
        if (ps) totalMax += maxCap(ps);
      }
      return {
        seat: rep,
        reason: null,
        keptExisting: true,
        capacityMismatch: judgeLinkedCapacity(persons, totalMax) !== null,
        keptSeatIds: preferIds,
        seatLabel: seatLabelOf(preferIds, args.seats),
      };
    }
  } else if (preferSeatId) {
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
  seatLinks?: SeatLinkMap;
}) {
  const { seat, members, reservations, persons, startAt, duration, excludeReservationId } = args;

  return {
    fitsPersons: persons >= minCap(seat) && persons <= maxCap(seat),
    conflicts: findConflicts({
      target: expandPhysicalSeatIds(String(seat.id), members),
      members,
      reservations,
      startAt,
      duration,
      excludeReservationId,
      seatLinks: args.seatLinks,
    }),
  };
}

function findConflicts(args: {
  target: Set<string>;
  members: SeatMemberRow[];
  reservations: ReservationRow[];
  startAt: Date;
  duration: number;
  excludeReservationId?: string | null;
  seatLinks?: SeatLinkMap;
}) {
  const { target, members, reservations, startAt, duration, excludeReservationId } = args;
  const endAt = addMinutes(startAt, duration);

  return reservations.filter((r) => {
    if (!r.seat_id || !r.start_at) return false;
    if (excludeReservationId && String(r.id) === String(excludeReservationId)) return false;
    if (["cancelled", "finished", "no_show"].includes(String(r.status))) return false;

    const rStart = new Date(r.start_at);
    const rEnd = addMinutes(rStart, Number(r.duration_minutes ?? 120));
    if (!overlaps(startAt, endAt, rStart, rEnd)) return false;

    return hasSeatConflict(target, reservationPhysicalSeatIds(r, members, args.seatLinks));
  });
}

// 席を1つ以上選んだときの判定(自由連結に対応)。
//  - 1席だけ: 従来どおり、その席の定員(min〜max)で判定する
//  - 2席以上: 物理席の定員の合計で「足りない」「取りすぎ」を判定する
//  - どちらも、選んだ席のどれか1つでも他の予約と重なれば conflicts に入る
export function evaluateSeatSelection(args: {
  seatIds: string[];
  seats: SeatRow[];
  members: SeatMemberRow[];
  reservations: ReservationRow[];
  persons: number;
  startAt: Date;
  duration: number;
  excludeReservationId?: string | null;
  seatLinks?: SeatLinkMap;
}) {
  const { seatIds, seats, members, persons } = args;
  const physicalIds = physicalIdsOf(seatIds, members);
  const conflicts = findConflicts({
    target: physicalIds,
    members,
    reservations: args.reservations,
    startAt: args.startAt,
    duration: args.duration,
    excludeReservationId: args.excludeReservationId,
    seatLinks: args.seatLinks,
  });
  const label = seatLabelOf(seatIds, seats);

  if (seatIds.length === 1) {
    const seat = seats.find((s) => String(s.id) === String(seatIds[0]));
    const fits = seat ? persons >= minCap(seat) && persons <= maxCap(seat) : true;
    return {
      physicalIds,
      conflicts,
      linked: false,
      totalMax: seat ? maxCap(seat) : 0,
      fitsPersons: fits,
      message:
        fits || !seat ? null : `${seat.name} は ${minCap(seat)}〜${maxCap(seat)}名の席です（${persons}名）。`,
      label,
    };
  }

  let totalMax = 0;
  for (const pid of physicalIds) {
    const ps = seats.find((s) => String(s.id) === pid);
    if (ps) totalMax += maxCap(ps);
  }
  const issue = judgeLinkedCapacity(persons, totalMax);
  const message =
    issue === "short"
      ? `選んだ席（${label}）の定員は合計${totalMax}名です（${persons}名）。席が足りません。`
      : issue === "oversize"
        ? `選んだ席（${label}）は合計${totalMax}名分で、${persons}名には多すぎます。ほかのお客様の席をふさぐ可能性があります。`
        : null;

  return { physicalIds, conflicts, linked: true, totalMax, fitsPersons: issue === null, message, label };
}

// 連結した席を維持したが、人数に対して足りない・多すぎるときの、現場向けの警告文
export function linkedSeatMismatchMessage(args: {
  label: string;
  persons: number;
  sourceLabel: string;
}) {
  const { label, persons, sourceLabel } = args;
  return `${sourceLabel}の変更で人数が${persons}名になりましたが、連結した席「${label}」のままです。席の数が人数に合っているか確認してください。`;
}
