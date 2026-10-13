-- タイムテーブルに表示されない可能性のある予約の確認用SELECT（読み取りのみ）。
-- タイムテーブルは「物理席（C1〜C8, T1-1〜T3-2）」の行だけを表示し、
-- グループ席（右テーブル・C-12 など）は seat_members のメンバー席の行に展開して表示する。
-- そのため、物理席でもなく、物理席のメンバーを持つグループ席でもない席に割り当てられた予約は表示されない。

-- 1) 席は割り当て済みなのにタイムテーブルに出ない予約（今日以降・有効なもの）
with physical as (
  select id from public.seats
  where (name ~ '^C[0-9]+$' or name ~ '^T[0-9]+-[0-9]+$')
    and coalesce(is_active, true)
)
select r.id,
       r.start_at at time zone 'Asia/Tokyo' as start_jst,
       r.persons,
       r.status,
       r.source,
       r.assignment_status,
       s.name as seat_name,
       r.seat_id
from public.reservations r
left join public.seats s on s.id = r.seat_id
where r.status not in ('cancelled', 'finished', 'no_show')
  and r.assignment_status = 'assigned'
  and r.start_at >= (now() - interval '1 day')
  and not (
    r.seat_id in (select id from physical)
    or exists (
      select 1 from public.seat_members m
      where m.group_seat_id = r.seat_id
        and m.member_seat_id in (select id from physical)
    )
  )
order by r.start_at;

-- 2) 「割り当て済み」なのに seat_id が空の予約
select id, start_at at time zone 'Asia/Tokyo' as start_jst, persons, status, source
from public.reservations
where status not in ('cancelled', 'finished', 'no_show')
  and assignment_status = 'assigned'
  and seat_id is null
  and start_at >= (now() - interval '1 day')
order by start_at;

-- 3) 参考: グループ席とメンバー席の対応（右テーブル → T1-1, T1-2 など）
select g.name as group_seat, string_agg(m.name, ', ' order by m.sort_order) as members
from public.seat_members sm
join public.seats g on g.id = sm.group_seat_id
join public.seats m on m.id = sm.member_seat_id
group by g.name, g.sort_order
order by g.sort_order;
