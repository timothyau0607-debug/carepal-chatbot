-- 在已有 001 的專案上執行：為「家屬／病者／醫護」分別儲存畫像與記憶條目。
-- 執行後 (user_key, user_role) 為 carepal_profiles 主鍵；memory 表帶同欄位並參考外鍵。

-- 1) 放開子表外鍵（名稱若不同，請在 Supabase 表上查看 Constraints 名稱後修改）
alter table if exists carepal_memory_entries
  drop constraint if exists carepal_memory_entries_user_key_fkey;

-- 2) 畫像表：身分欄＋複合主鍵
alter table if exists carepal_profiles
  add column if not exists user_role text not null default 'family'
  check (user_role in ('family', 'patient', 'staff'));

alter table if exists carepal_profiles
  drop constraint if exists carepal_profiles_pkey;

alter table if exists carepal_profiles
  add primary key (user_key, user_role);

-- 3) 記憶表：外鍵欄（既有列預設為家屬脈絡 family）
alter table if exists carepal_memory_entries
  add column if not exists user_role text not null default 'family'
  check (user_role in ('family', 'patient', 'staff'));

alter table if exists carepal_memory_entries
  drop constraint if exists carepal_memory_entries_profile_fk;

alter table if exists carepal_memory_entries
  add constraint carepal_memory_entries_profile_fk
  foreign key (user_key, user_role) references carepal_profiles (user_key, user_role)
  on delete cascade;

drop index if exists carepal_memory_entries_user_created_idx;

create index if not exists carepal_memory_entries_user_role_created_idx
  on carepal_memory_entries (user_key, user_role, created_at desc);
