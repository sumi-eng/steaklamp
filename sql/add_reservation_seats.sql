-- 席の自由連結：予約と物理席を多対多で持つテーブルと、連結を置き換える関数。
-- 実行はオーナーが行う（Supabase の SQL Editor）。何度実行しても壊れない書き方にしてある。
--
-- 考え方
--  - 連結のない予約（これまでのすべての予約）は行を持たず、reservations.seat_id だけで席を表す。
--  - 連結した予約だけ、この表に「連結したすべての席」を持つ。reservations.seat_id は代表席（選んだ最初の席）。
--  - 席マスタの削除は on delete restrict で止める（連結に使われている席は削除できない）。
--  - 予約を削除すると連結の行も消える（on delete cascade）。
--  - サーバー（service role）だけが読み書きする。RLS を有効にしてポリシーは作らない。

create table if not exists public.reservation_seats (
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  seat_id        uuid not null references public.seats(id) on delete restrict,
  primary key (reservation_id, seat_id)
);

create index if not exists reservation_seats_seat_id_idx
  on public.reservation_seats (seat_id);

alter table public.reservation_seats enable row level security;
revoke all on table public.reservation_seats from anon, authenticated;
grant all on table public.reservation_seats to service_role;

-- 連結を渡した席に置き換える（削除→挿入を1トランザクションで行う）。
-- 席が1つ以下のときは、連結の行をすべて消すだけ＝単独の席・グループ席に戻したときに古い連結が残らない。
create or replace function public.replace_reservation_seats(
  p_reservation_id uuid,
  p_seat_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.reservation_seats where reservation_id = p_reservation_id;

  if coalesce(array_length(p_seat_ids, 1), 0) > 1 then
    insert into public.reservation_seats (reservation_id, seat_id)
    select p_reservation_id, s
    from (select distinct unnest(p_seat_ids) as s) t;
  end if;
end;
$$;

-- お客様側（anon / authenticated）からは呼べないようにする
revoke all on function public.replace_reservation_seats(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.replace_reservation_seats(uuid, uuid[]) to service_role;

-- ===== 実行後の確認（読み取りのみ） =====
-- 1) 表と関数ができたか
--   select count(*) from public.reservation_seats;  -- 0 のはず
--   select proname from pg_proc where proname = 'replace_reservation_seats';
-- 2) 連結に使われている席（削除できない席）の一覧
--   select s.name, count(*) as reservations
--   from public.reservation_seats rs join public.seats s on s.id = rs.seat_id
--   group by s.name order by s.name;
-- 3) 代表席が連結に含まれていない古い行（あれば無効として扱われる。保存時に掃除される）
--   select rs.reservation_id, r.seat_id
--   from public.reservation_seats rs join public.reservations r on r.id = rs.reservation_id
--   group by rs.reservation_id, r.seat_id
--   having bool_or(rs.seat_id = r.seat_id) = false;
