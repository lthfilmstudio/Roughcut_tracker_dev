-- ============================================================
-- Harden RPC Execute Permissions（2026-05-14）
-- ============================================================
-- 目的：撤銷未登入訪客（anon / public）對自訂 RPC 的 EXECUTE 權限
--
-- 為什麼：Security Advisor 警告「Public Can Execute SECURITY DEFINER
-- Function」。雖然每個 function 內部都有 is_super_admin() 等檢查擋住，
-- 但讓未登入訪客連戳都戳不到才符合最小權限原則。
--
-- 影響：前端流程不受影響。
--   - 所有 RPC 呼叫都發生在 Google 登入後（authenticated 角色）
--   - convert_pending_invites_on_signup 是 trigger function，
--     由 postgres 內部 fire，不需要任何 client EXECUTE 權限
--
-- 怎麼跑：
--   1. 進 Supabase Dashboard → 左側 SQL Editor
--   2. 貼上整份檔案內容
--   3. 點 Run，看到「Success. No rows returned」就好
--   4. 重新整理 Security Advisor，Warnings 從 20 降到 11
-- ============================================================


-- ------------------------------------------------------------
-- 1. 內部 RPC：撤銷 public/anon，保留 authenticated
-- ------------------------------------------------------------
revoke execute on function public.is_super_admin()                                       from public, anon;
revoke execute on function public.project_role(text)                                     from public, anon;
revoke execute on function public.project_role_of_episode(uuid)                          from public, anon;
revoke execute on function public.list_project_members(text)                             from public, anon;
revoke execute on function public.add_project_member_by_email(text, text, member_role)   from public, anon;
revoke execute on function public.remove_project_member(uuid, text)                      from public, anon;
revoke execute on function public.list_pending_invites(text)                             from public, anon;
revoke execute on function public.cancel_pending_invite(uuid)                            from public, anon;

grant execute on function public.is_super_admin()                                        to authenticated;
grant execute on function public.project_role(text)                                      to authenticated;
grant execute on function public.project_role_of_episode(uuid)                           to authenticated;
grant execute on function public.list_project_members(text)                              to authenticated;
grant execute on function public.add_project_member_by_email(text, text, member_role)    to authenticated;
grant execute on function public.remove_project_member(uuid, text)                       to authenticated;
grant execute on function public.list_pending_invites(text)                              to authenticated;
grant execute on function public.cancel_pending_invite(uuid)                             to authenticated;


-- ------------------------------------------------------------
-- 2. Trigger function：完全撤銷所有 client EXECUTE
-- （由 auth.users insert trigger 內部 fire，不靠 client 呼叫）
-- ------------------------------------------------------------
revoke execute on function public.convert_pending_invites_on_signup() from public, anon, authenticated;


-- ============================================================
-- 完成
-- ============================================================
