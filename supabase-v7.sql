-- =====================================================
-- Fuo Tools · v7 增量：System 管理端重置任意账号密码
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 幂等：可重复执行（drop + create，权限随重建刷新）
-- 前置：supabase-setup.sql（profiles 表）已执行
--
-- 提供 RPC：admin_reset_password(target_username, new_password)
--   · 仅 profiles.username 恰为 'System' 的登录用户可调用（函数体内校验，
--     前端 Terminal / 管理台的门禁只是体验层）
--   · EXECUTE 只授予 authenticated：匿名 / anon key 直接被拒（第一道门）
--   · 密码 8-72 位（bcrypt 上限 72 字节，按字节校验）；pgcrypto bcrypt
--     （$2a$ 成本 10）加密入库，与 GoTrue 登录校验同算法，改完即刻可登录
--   · 重置后清除目标用户的 refresh_tokens / sessions（强制重新登录）
--   · 自动写入 audit_log（action = admin_reset_password），明文不落库
--   · 不能重置 System 自己（请在站点设置页「修改密码」自助操作）
--
-- 入口：Terminal → passwd <用户名> <新密码>
--       管理台 /drive/admin → 用户 tab → 每行「改密」按钮
-- =====================================================

-- 0) bcrypt 依赖（Supabase 默认已装在 extensions schema，此行为兜底）
create extension if not exists pgcrypto with schema extensions;

-- 1) 删除旧版本（保证幂等，权限随重建刷新）
drop function if exists public.admin_reset_password(text, text);

-- 2) 创建函数
create function public.admin_reset_password(target_username text, new_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_name text;
  target_id   uuid;
  target_name text;
  new_hash    text;
begin
  -- ① 调用者必须是已登录用户
  if auth.uid() is null then
    raise exception 'FUO_PASSWD_AUTH: 请先登录后再调用';
  end if;

  -- ② 调用者必须是 System（数据库侧校验，与 ban/rename 同款防线）
  select p.username into caller_name
  from public.profiles p
  where p.id = auth.uid();
  if caller_name is null or caller_name <> 'System' then
    raise exception 'FUO_PASSWD_FORBIDDEN: 仅 System 账号可以重置密码';
  end if;

  -- ③ 参数校验
  target_username := coalesce(trim(target_username), '');
  new_password    := coalesce(new_password, '');
  if target_username = '' then
    raise exception 'FUO_PASSWD_ARGS: 目标用户名不能为空';
  end if;
  if char_length(new_password) < 8 then
    raise exception 'FUO_PASSWD_LEN: 新密码至少 8 位（当前 % 位）', char_length(new_password);
  end if;
  if octet_length(new_password) > 72 then
    raise exception 'FUO_PASSWD_LEN: 密码过长（bcrypt 上限 72 字节，中文每字占 3 字节）';
  end if;
  if target_username = 'System' then
    raise exception 'FUO_PASSWD_SELF: 不能通过管理端重置 System 自己的密码，请在设置页自助修改';
  end if;

  -- ④ 目标必须存在
  select p.id, p.username into target_id, target_name
  from public.profiles p
  where p.username = target_username;
  if target_id is null then
    raise exception 'FUO_PASSWD_NOUSER: 用户名不存在：%', target_username;
  end if;

  -- ⑤ bcrypt 加密（$2a$ 成本 10，与 GoTrue 同算法）
  new_hash := extensions.crypt(new_password, extensions.gen_salt('bf', 10));

  -- ⑥ 改密码
  update auth.users
     set encrypted_password = new_hash,
         updated_at = now()
   where id = target_id;

  -- ⑦ 踢掉目标用户的全部会话（refresh tokens / sessions）
  --    清理失败不影响改密结果：旧登录态最多再维持一个 access token 有效期
  begin
    delete from auth.refresh_tokens where user_id = target_id;
    delete from auth.sessions       where user_id = target_id;
  exception when others then
    null;
  end;

  -- ⑧ 留痕（明文不落库，只记长度与执行方）
  insert into public.audit_log (actor_id, action, target, detail)
  values (auth.uid(), 'admin_reset_password', target_name,
          '重置密码（' || char_length(new_password) || ' 位，已踢出其全部会话）· 管理端执行');

  return 'OK：用户 ' || target_name || ' 的密码已重置，其全部会话已失效，需用新密码重新登录';
end;
$$;

-- 3) 权限锁定：public / anon 一律不可调用，仅 authenticated
--    （真正的身份校验在函数体内，这里是第一道门）
revoke all on function public.admin_reset_password(text, text) from public;
revoke all on function public.admin_reset_password(text, text) from anon;
grant execute on function public.admin_reset_password(text, text) to authenticated;

-- 完成！验证方式：
--   ① SQL Editor 里以匿名身份模拟不了 RPC，请直接上线验证：
--      Terminal 输入 passwd <用户名> <新密码>，或管理台用户 tab「改密」
--   ② 非 System 登录时调用会收到 FUO_PASSWD_FORBIDDEN
--   ③ 操作会在管理台/终端 audit 里留下 admin_reset_password 记录（无明文）
