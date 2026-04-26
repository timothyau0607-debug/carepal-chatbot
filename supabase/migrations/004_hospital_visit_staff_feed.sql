-- 醫院場景：到院/陪診情境、與醫護互動滿意度；家屬/病友寫入「給醫護看的今日摘要」供 staff 帳戶參考。
-- 須在 003 之後執行。

alter table if exists carepal_profiles
  add column if not exists visit_context text not null default '';

alter table if exists carepal_profiles
  add column if not exists staff_interaction_satisfaction text not null default '';

comment on column carepal_profiles.visit_context is
  '是否今日到院、陪診/本人就診等（由對話歸納＋可手改）';
comment on column carepal_profiles.staff_interaction_satisfaction is
  '與醫護互動是否滿意等（由對話歸納＋可手改）';

create table if not exists carepal_staff_feed (
  id uuid primary key default gen_random_uuid(),
  contributor_key text not null
    check (char_length(contributor_key) >= 8 and char_length(contributor_key) <= 128),
  contributor_role text not null
    check (contributor_role in ('family', 'patient')),
  signal_date date not null,
  one_line text not null default '',
  questions_asked text not null default '',
  praise_for_staff text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contributor_key, contributor_role, signal_date)
);

create index if not exists carepal_staff_feed_date_idx
  on carepal_staff_feed (signal_date desc);

comment on table carepal_staff_feed is
  '家屬/病友帳戶的「今日一句＋常問＋讚美」摘要，供醫護帳戶併入對話。';

alter table if exists carepal_staff_feed enable row level security;
