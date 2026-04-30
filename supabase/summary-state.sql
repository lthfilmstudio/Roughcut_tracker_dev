-- ------------------------------------------------------------
-- summary_state — 給 scripts/daily-summary.py 記「上次推播狀態」用
--
-- 用途：每日剪輯日報改成「跟上次推播比的 diff」模式，
-- 不再依賴執行當下的台北日期，避免 GitHub Actions cron
-- 跨午夜延遲時算錯日期。
--
-- 結構：單列表（id = 'singleton'），存兩樣資料：
--   - last_push_at：上次推播完成的時間
--   - snapshot：上次推播當下，每集的累積快照（jsonb）
--     格式：{"episodes": {"<ep_id>": {"total_secs": 1234,
--                                     "cut_scenes": 12,
--                                     "total_scenes": 20}}}
--
-- 怎麼跑：
--   1. 進 Supabase 專案 → 左側 SQL Editor
--   2. 貼上整份檔案內容
--   3. 點 Run，看到「Success. No rows returned」就好
--   4. 第一次跑會塞一筆 snapshot 為空、last_push_at = now() 的初始 row
-- ------------------------------------------------------------

create table if not exists summary_state (
  id           text primary key default 'singleton',
  last_push_at timestamptz not null default now(),
  snapshot     jsonb        not null default '{}'::jsonb,
  updated_at   timestamptz  not null default now(),
  constraint singleton_only check (id = 'singleton')
);

insert into summary_state (id) values ('singleton')
on conflict (id) do nothing;

-- script 用 service role key 直接讀寫，不開放 RLS（service key 本來就繞 RLS）
-- 但保險起見還是啟用 + 不給 anon/authenticated 權限
alter table summary_state enable row level security;
