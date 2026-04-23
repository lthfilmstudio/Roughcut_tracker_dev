-- ============================================================
-- Roughcut Tracker — Supabase Schema (PoC v0.1)
-- ============================================================
-- 建立日期：2026-04-23
-- 對應的 Google Sheet 結構見：src/types/index.ts + src/config/projectConfig.ts
--
-- 使用方式：
--   1. 在 supabase.com 建一個 project
--   2. 進 SQL Editor，整份貼上執行
--   3. 跑完後到 Table Editor 看 projects / episodes / scenes 等表
--
-- 設計決定：
--   - 總覽不存，從 scenes 即時加總
--   - 長度存秒數整數（roughcut_length_secs），不用 INTERVAL
--   - 場次排序用 row_order 欄位，維持 9A 排在 9 後面的手調順序
--   - 拿掉應用密碼，改用 email 權限表（project_members）
-- ============================================================


-- ------------------------------------------------------------
-- Extensions
-- ------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()


-- ------------------------------------------------------------
-- Types (enum)
-- ------------------------------------------------------------
create type project_type as enum ('series', 'film');
create type scene_status as enum ('已初剪', '已精剪', '整場刪除');
create type member_role  as enum ('admin', 'editor', 'viewer');


-- ------------------------------------------------------------
-- Table: projects
--   對應 Meta Sheet 的 Projects 分頁
-- ------------------------------------------------------------
create table projects (
  id               text primary key,         -- 'beicheng', 'yinluren', ...
  name             text not null,            -- '北城百畫帖'
  type             project_type not null,
  episode_count    integer,                  -- 劇集才有，電影為 null
  episode_prefix   text,                     -- 'ep'；電影為 null
  legacy_sheet_id  text,                     -- 舊 Google Sheet ID（遷移期間保留）
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);


-- ------------------------------------------------------------
-- Table: episodes
--   劇集的每一集；電影只會有一列（ep_key = 'Scenes'）
-- ------------------------------------------------------------
create table episodes (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null references projects(id) on delete cascade,
  ep_key         text not null,             -- 'ep01', 'ep02', 'Scenes'
  display_order  integer not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, ep_key)
);

create index episodes_project_order_idx on episodes (project_id, display_order);


-- ------------------------------------------------------------
-- Table: scenes
--   場次資料（核心表）
-- ------------------------------------------------------------
create table scenes (
  id                    uuid primary key default gen_random_uuid(),
  episode_id            uuid not null references episodes(id) on delete cascade,
  scene_key             text not null,            -- '9A', '28ins', '15A'
  roughcut_length_secs  integer,                  -- null = 未剪
  pages                 numeric(6,2),             -- 允許小數（0.1, 2.5）
  roughcut_date         date,
  status                scene_status,             -- null = 空白
  missing_shots         boolean not null default false,
  notes                 text,
  row_order             integer not null,         -- 顯示順序（可手調）
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (episode_id, scene_key)
);

create index scenes_episode_order_idx on scenes (episode_id, row_order);
create index scenes_status_idx        on scenes (episode_id, status);


-- ------------------------------------------------------------
-- Table: episode_meta
--   存精剪總長等「不由場次加總」的 K/V 資料
--   對應現有專案 Sheet 的 _meta tab
-- ------------------------------------------------------------
create table episode_meta (
  episode_id  uuid not null references episodes(id) on delete cascade,
  key         text not null,               -- 'finecutTotalLength' 等
  value       text not null,               -- 以字串存，前端解析
  updated_at  timestamptz not null default now(),
  primary key (episode_id, key)
);


-- ------------------------------------------------------------
-- Table: project_members
--   誰可以進哪個專案、什麼角色（取代 Google Drive 共用清單）
-- ------------------------------------------------------------
create table project_members (
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  text not null references projects(id) on delete cascade,
  role        member_role not null default 'editor',
  created_at  timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index project_members_user_idx on project_members (user_id);


-- ------------------------------------------------------------
-- Table: super_admins
--   跨全站管理者（看得到所有專案）
-- ------------------------------------------------------------
create table super_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);


-- ============================================================
-- Triggers: 自動更新 updated_at
-- ============================================================
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger t_projects_touch
  before update on projects
  for each row execute function touch_updated_at();

create trigger t_episodes_touch
  before update on episodes
  for each row execute function touch_updated_at();

create trigger t_scenes_touch
  before update on scenes
  for each row execute function touch_updated_at();

create trigger t_episode_meta_touch
  before update on episode_meta
  for each row execute function touch_updated_at();


-- ============================================================
-- Row Level Security (RLS) — 第一版
-- ============================================================
-- 原則：
--   1. super_admin 可以讀寫所有東西
--   2. project_members 只能看到自己有份的專案
--   3. editor/admin 可以寫 scenes/episode_meta；viewer 只能讀
--   4. project_members 這張表只有 super_admin 能改（加/移除成員）
--
-- 備註：這是初版骨架，實際 policy 要依使用情境再調整。
-- ============================================================

alter table projects         enable row level security;
alter table episodes         enable row level security;
alter table scenes           enable row level security;
alter table episode_meta     enable row level security;
alter table project_members  enable row level security;
alter table super_admins     enable row level security;


-- Helper functions --------------------------------------------

create or replace function is_super_admin()
returns boolean language sql stable as $$
  select exists (select 1 from super_admins where user_id = auth.uid())
$$;

create or replace function project_role(p_id text)
returns member_role language sql stable as $$
  select role from project_members
  where user_id = auth.uid() and project_id = p_id
$$;

create or replace function project_role_of_episode(ep_id uuid)
returns member_role language sql stable as $$
  select project_role(project_id) from episodes where id = ep_id
$$;


-- Policies: super_admin 全權 -----------------------------------

create policy super_admin_all_projects        on projects
  for all using (is_super_admin()) with check (is_super_admin());

create policy super_admin_all_episodes        on episodes
  for all using (is_super_admin()) with check (is_super_admin());

create policy super_admin_all_scenes          on scenes
  for all using (is_super_admin()) with check (is_super_admin());

create policy super_admin_all_meta            on episode_meta
  for all using (is_super_admin()) with check (is_super_admin());

create policy super_admin_all_members         on project_members
  for all using (is_super_admin()) with check (is_super_admin());

create policy super_admin_all_super           on super_admins
  for all using (is_super_admin()) with check (is_super_admin());


-- Policies: member 讀取權限 ------------------------------------

create policy member_read_projects on projects
  for select using (project_role(id) is not null);

create policy member_read_episodes on episodes
  for select using (project_role(project_id) is not null);

create policy member_read_scenes on scenes
  for select using (project_role_of_episode(episode_id) is not null);

create policy member_read_meta on episode_meta
  for select using (project_role_of_episode(episode_id) is not null);

create policy member_read_own_membership on project_members
  for select using (user_id = auth.uid());


-- Policies: editor/admin 寫入權限（scenes / episode_meta） -----

create policy editor_write_scenes on scenes
  for all
  using (project_role_of_episode(episode_id) in ('admin', 'editor'))
  with check (project_role_of_episode(episode_id) in ('admin', 'editor'));

create policy editor_write_meta on episode_meta
  for all
  using (project_role_of_episode(episode_id) in ('admin', 'editor'))
  with check (project_role_of_episode(episode_id) in ('admin', 'editor'));


-- ============================================================
-- 完成
-- ============================================================
-- 下一步：
--   1. 在 Dashboard → Authentication → Providers 開啟 Google
--   2. 新增第一個 super_admin（用 SQL insert，或等 Nalin 第一次登入後手動加）
--   3. 建好 1~2 個測試專案，驗證 RLS 行為正確
--   4. 寫遷移腳本把現有 Google Sheet 資料倒進來
-- ============================================================
