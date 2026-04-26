-- 在 Supabase 專案：SQL Editor 執行此檔，或匯入為 migration。
-- 建議以 Service Role 僅在 Next.js 伺服器端讀寫，勿把 Service Role 金鑰給前端。

create table if not exists carepal_profiles (
  user_key text primary key
    check (char_length(user_key) >= 8 and char_length(user_key) <= 128),
  display_name text not null default '訪客',
  family_notes text not null default '',
  mood_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists carepal_memory_entries (
  id uuid primary key default gen_random_uuid(),
  user_key text not null references carepal_profiles (user_key) on delete cascade,
  content text not null,
  kind text not null default 'note',
  created_at timestamptz not null default now()
);

create index if not exists carepal_memory_entries_user_created_idx
  on carepal_memory_entries (user_key, created_at desc);

-- 以 anon 金鑰不應直接讀寫；若你仍要開放，請自行補 RLS 政策。使用 Service Role 的 API 會繞過 RLS。
alter table carepal_profiles enable row level security;
alter table carepal_memory_entries enable row level security;
