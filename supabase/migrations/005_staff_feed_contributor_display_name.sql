-- 家屬/病友之去識別稱呼，供醫護端轉述「某某想道謝」
alter table if exists carepal_staff_feed
  add column if not exists contributor_display_name text not null default '';

comment on column carepal_staff_feed.contributor_display_name is
  '家屬或病友在畫像中的稱呼（去識別），供併入醫護 system prompt 之轉述用';
