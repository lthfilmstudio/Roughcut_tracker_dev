-- ============================================================
-- 成員管理 RPC（2026-04-24）
-- ============================================================
-- 目的：讓前端 super_admin 可用 UI 邀請/列出/移除專案成員，
--       不用每次跑手寫 SQL。
--
-- 為什麼要 security definer：
--   auth.users 是 Supabase 系統表，前端 anon/authenticated 角色
--   讀不到 email。用 security definer function 封裝，內部以 postgres
--   身分查 auth.users，外面再自己檢查呼叫者是 super_admin。
--
-- 使用方式：
--   1. 到 Supabase Dashboard → SQL Editor
--   2. 整份貼上 → Run
--   3. 完成後前端 UI 才會動
-- ============================================================


-- ------------------------------------------------------------
-- 列出專案成員（super_admin 才能呼叫）
-- ------------------------------------------------------------
create or replace function list_project_members(p_project_id text)
returns table (
  user_id    uuid,
  email      text,
  role       member_role,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_super_admin() then
    raise exception '只有 super_admin 能查看成員清單';
  end if;

  return query
    select pm.user_id, u.email::text, pm.role, pm.created_at
    from project_members pm
    join auth.users u on u.id = pm.user_id
    where pm.project_id = p_project_id
    order by pm.created_at;
end;
$$;


-- ------------------------------------------------------------
-- 用 email 新增/更新成員
--   - email 找得到：insert or update role（upsert）
--   - email 找不到：回傳 status='not_found'（前端提示對方先登入）
-- ------------------------------------------------------------
create or replace function add_project_member_by_email(
  p_email      text,
  p_project_id text,
  p_role       member_role
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_email   text := lower(trim(p_email));
begin
  if not is_super_admin() then
    raise exception '只有 super_admin 能新增成員';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = v_email
  limit 1;

  if v_user_id is null then
    return jsonb_build_object(
      'status', 'not_found',
      'email', v_email
    );
  end if;

  insert into project_members (user_id, project_id, role)
  values (v_user_id, p_project_id, p_role)
  on conflict (user_id, project_id)
  do update set role = excluded.role;

  return jsonb_build_object(
    'status', 'ok',
    'user_id', v_user_id,
    'email', v_email
  );
end;
$$;


-- ------------------------------------------------------------
-- 移除成員
-- ------------------------------------------------------------
create or replace function remove_project_member(
  p_user_id    uuid,
  p_project_id text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_super_admin() then
    raise exception '只有 super_admin 能移除成員';
  end if;

  delete from project_members
  where user_id = p_user_id and project_id = p_project_id;
end;
$$;


-- ============================================================
-- 完成
-- ============================================================
