-- 確認用SELECT（読み取りのみ）。Supabase SQL Editorで実行して結果を共有してください。

-- 1) reservations の列定義
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'reservations'
order by ordinal_position;

-- 2) 一意制約・インデックス
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'reservations';

-- 3) 外部予約番号の重複（0行なら一意制約を追加可能）
select store_id, external_source, external_reservation_id, count(*) as cnt
from public.reservations
where external_reservation_id is not null
group by store_id, external_source, external_reservation_id
having count(*) > 1;

-- 4) status の使用値
select status, count(*) from public.reservations group by status;

-- 5) 外部予約番号の保存形式（食べログは "net:48912424" のように接頭辞付きで保存されているか）
select external_source,
       left(external_reservation_id, 12) as sample_id,
       length(external_reservation_id) as len,
       status,
       start_at
from public.reservations
where external_source in ('tabelog', 'ikyu', 'hotpepper')
order by created_at desc
limit 30;
