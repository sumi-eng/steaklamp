-- 一意制約が無かった場合のみ実行（上の確認SQLで重複0行を確認してから）。
-- 実行前にユーザー確認が必要。
create unique index concurrently if not exists reservations_external_unique
  on public.reservations (store_id, external_source, external_reservation_id)
  where external_reservation_id is not null;
