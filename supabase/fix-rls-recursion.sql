-- ============================================================
-- RLS 修正：避免 helper function 觸發自己的 policy 造成遞迴
-- 2026-04-23
-- ============================================================
-- 問題：
--   原本 is_super_admin() 從 super_admins 表讀資料，
--   但 super_admins 的 RLS policy 本身又呼叫 is_super_admin()，
--   → 遞迴：stack depth limit exceeded
--
-- 修法：
--   1. Helper function 加 `security definer` → 繞過 RLS 去查
--   2. super_admins 的 policy 改成「讀自己那一列」（最弱但足夠的條件）
-- ============================================================

-- --- Helper function 改 security definer ----------------------

create or replace function is_super_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from super_admins where user_id = auth.uid())
$$;

create or replace function project_role(p_id text)
returns member_role language sql stable security definer
set search_path = public
as $$
  select role from project_members
  where user_id = auth.uid() and project_id = p_id
$$;

create or replace function project_role_of_episode(ep_id uuid)
returns member_role language sql stable security definer
set search_path = public
as $$
  select project_role(project_id) from episodes where id = ep_id
$$;

-- --- super_admins 的 policy 換成讀自己那列 ---------------------

drop policy if exists super_admin_all_super on super_admins;

create policy read_own_super_admin on super_admins
  for select using (user_id = auth.uid());

-- super_admins 的 insert/update/delete 只能由 service_role 做
-- （service_role 會 bypass RLS，所以不需要 policy）
