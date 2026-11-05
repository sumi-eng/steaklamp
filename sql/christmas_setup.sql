-- クリスマスコース用のDB変更（Supabase SQL Editor で実行）
-- 実行前にユーザー確認が必要。上から順に、ブロックごとに実行できる。

-- ============================================================
-- 1) 日ごとの受付の手動締切テーブル
--    RLSを有効にし、ポリシーは作らない＝anon / authenticated からは読み書きできない。
--    サーバー側の service role（RLSを bypass する）だけが読み書きする。
-- ============================================================
create table if not exists public.christmas_day_settings (
  event_date date primary key,
  is_closed boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.christmas_day_settings enable row level security;

-- 念のため、テーブル権限も anon / authenticated から外す
revoke all on table public.christmas_day_settings from anon, authenticated;

insert into public.christmas_day_settings (event_date)
values ('2026-12-24'), ('2026-12-25')
on conflict (event_date) do nothing;

-- ============================================================
-- 2) 予約テーブルに列を追加
--    cancel_policy_agreed_at : キャンセルポリシーに同意した日時（自社ページ）
--    reminder_sent_at        : 前日リマインドを送った日時（二重送信防止）
-- ============================================================
alter table public.reservations
  add column if not exists cancel_policy_agreed_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;

-- ============================================================
-- 3) 12/24・12/25 が休みになっていないかの確認（読み取りのみ）
-- ============================================================
-- 3-1) 休業日（臨時休業）。予約作成・席検索・管理画面の休業日機能が参照する
select * from public.store_closures
where closed_on in ('2026-12-24', '2026-12-25');

-- 3-2) カレンダー（ネット予約の日付表示）が参照する special_closures
--      列名が環境で異なる可能性があるため、まず全体を見て 12/24・25 の行があるか確認する
select * from public.special_closures order by 1 desc limit 100;

-- 3-3) 曜日ごとの定休日設定（is_closed = true の曜日は 0=日 〜 6=土）
--      12/24(木)=4、12/25(金)=5 が true なら、通常のカレンダーでは休み扱い
select weekday, is_closed, open_on_day_before_holiday, open_time, close_time
from public.business_hours
order by weekday;

-- ============================================================
-- 4) 休みになっていた場合のみ実行：12/24・25 を営業日にする
--    ※ 3-1 で行が出た場合
-- ============================================================
-- delete from public.store_closures
-- where closed_on in ('2026-12-24', '2026-12-25');

--    ※ 3-2 で 12/24・25 の行が出た場合は、その行の日付列名（closed_on / date / target_date）に合わせて削除
-- delete from public.special_closures
-- where closed_on in ('2026-12-24', '2026-12-25');

--    ※ 曜日の定休日（business_hours）は、変更すると毎週の営業日が変わってしまうため、ここでは変更しない。
--      クリスマスコースの予約ページは曜日の定休日を参照せず、store_closures（臨時休業）だけを確認する。
