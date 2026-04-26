-- 在使用者畫像上擴充：系統從對話歸納的摘要，以及手動填寫的偏好／性格，供併入 LLM 脈絡。
-- 須在 002 之後執行。

alter table if exists carepal_profiles
  add column if not exists inferred_profile text not null default '';

alter table if exists carepal_profiles
  add column if not exists preferences text not null default '';

alter table if exists carepal_profiles
  add column if not exists traits text not null default '';

comment on column carepal_profiles.inferred_profile is
  '由伺服器在對話後以 LLM 增量維護的穩定畫像（稱呼、關係、關心點、溝通風格等條列）';
comment on column carepal_profiles.preferences is
  '使用者可編輯的偏好、飲食與溝通習慣等';
comment on column carepal_profiles.traits is
  '使用者可編輯的性格、表達方式或互動風格';
