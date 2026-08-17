-- SNSログインしたお客様のプロフィール（お名前・電話番号・メールアドレス）を
-- 予約確定時に保存し、次回ログイン時の自動入力に使うテーブル。
create table if not exists steaklamp_guest_profiles (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_account_id text not null,
  name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);

create index if not exists steaklamp_guest_profiles_provider_idx
  on steaklamp_guest_profiles (provider, provider_account_id);

alter table steaklamp_guest_profiles enable row level security;

-- service role key（サーバー側 API）からのみアクセスする想定のため、
-- クライアント向けの公開ポリシーは作成しない。
