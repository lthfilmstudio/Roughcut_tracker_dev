-- ============================================================
-- Pending Invites + 自動加入 trigger（2026-04-24）
-- ============================================================
-- 目的：super_admin 可以對「還沒登入過系統」的 email 先發邀請，
--       對方登入 Google 的那一刻自動加入對應專案，不用 Nalin 再操作。
--
-- 使用方式：
--   1. Supabase Dashboard → SQL Editor → 貼整份 → Run
--   2. 前端 UI 會自動切換成新流程（升級後的 add_project_member_by_email）
-- ============================================================


-- ------------------------------------------------------------
-- 1. pending_invites 表
-- ------------------------------------------------------------
create table if not exists pending_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,                       -- 存小寫
  project_id  text not null references projects(id) on delete cascade,
  role        member_role not null default 'editor',
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists pending_invites_email_project_uniq
  on pending_invites (email, project_id);

create index if not exists pending_invites_email_idx
  on pending_invites (email);

alter table pending_invites enable row level security;

-- 只 super_admin 能看/改（雖然查詢都走 RPC，保險起見開 policy）
drop policy if exists super_admin_all_pending on pending_invites;
create policy super_admin_all_pending on pending_invites
  for all using (is_super_admin()) with check (is_super_admin());


-- ------------------------------------------------------------
-- 2. trigger：新使用者登入時自動吃掉 pending_invites
-- ------------------------------------------------------------
create or replace function convert_pending_invites_on_signup()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  -- 把符合 email 的 pending 全部轉成 project_members
  insert into project_members (user_id, project_id, role)
  select new.id, pi.project_id, pi.role
  from pending_invites pi
  where lower(pi.email) = lower(new.email)
  on conflict (user_id, project_id) do update set role = excluded.role;

  -- 清掉已處理的邀請
  delete from pending_invites where lower(email) = lower(new.email);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_convert_invites on auth.users;
create trigger on_auth_user_created_convert_invites
  after insert on auth.users
  for each row execute function convert_pending_invites_on_signup();


-- ------------------------------------------------------------
-- 3. 升級 add_project_member_by_email：找不到 email 改成建立 pending_invite
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

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;

  -- Case 1：使用者已存在 → 直接加 project_members
  if v_user_id is not null then
    insert into project_members (user_id, project_id, role)
    values (v_user_id, p_project_id, p_role)
    on conflict (user_id, project_id) do update set role = excluded.role;

    return jsonb_build_object(
      'status', 'ok',
      'user_id', v_user_id,
      'email', v_email
    );
  end if;

  -- Case 2：使用者不存在 → 建立 pending_invite（如果已經邀過就更新 role）
  insert into pending_invites (email, project_id, role, invited_by)
  values (v_email, p_project_id, p_role, auth.uid())
  on conflict (email, project_id) do update set role = excluded.role;

  return jsonb_build_object(
    'status', 'pending',
    'email', v_email
  );
end;
$$;


-- ------------------------------------------------------------
-- 4. 列/取消 pending_invites
-- ------------------------------------------------------------
create or replace function list_pending_invites(p_project_id text)
returns table (
  id         uuid,
  email      text,
  role       member_role,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_super_admin() then
    raise exception '只有 super_admin 能查看待邀請清單';
  end if;

  return query
    select pi.id, pi.email, pi.role, pi.created_at
    from pending_invites pi
    where pi.project_id = p_project_id
    order by pi.created_at;
end;
$$;

create or replace function cancel_pending_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not is_super_admin() then
    raise exception '只有 super_admin 能取消邀請';
  end if;

  delete from pending_invites where id = p_invite_id;
end;
$$;


-- ============================================================
-- 完成
-- ============================================================
