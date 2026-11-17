-- =====================================================
-- Fuo Tools · Tester 统一密码脚本（supabase-tester-password.sql）
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 幂等：可重复执行；新增 Tester 后重跑，编号按注册顺序自动重排
--
-- ── 规则（站点长期设置）──────────────────────────────
-- · 识别：用户名含 "tester"（不分大小写）= Tester 账号
--   （profiles.username 优先，回退注册名 / 邮箱前缀；
--     Finokuo / System 等普通账号不受影响）
-- · 编号：按账号真实注册时间 auth.users.created_at 从早到晚
-- · 密码：123456T + 序号（第 1 个 → 123456T1，第 2 个 → 123456T2…）
--
-- ── 当前预期名单（2026-11-10 以 anon key 核对线上 profiles）──
--   #1  Tester1_Ripple   ripple-tester-2025@163.com  → 123456T1（banned 状态不变）
--   #2  Tester2_Note     note-tester-2025@163.com    → 123456T2（banned 状态不变）
--   #3  V8Tester         v8tester-2025@163.com       → 123456T3
--
-- ── 执行后效果 ──────────────────────────────────────
-- · 旧密码全部失效，Tester 只能用新密码登录
-- · 已登录 Tester 的会话被清除，需用新密码重新登录
-- · 每个账号在 audit_log 留痕（管理台 / Terminal 可查）
--
-- 提示：想先核对名单再动手，可只选中「第 1 段」单独 Run；
--       确认无误后回到这里整段执行。
-- =====================================================

-- 0) bcrypt 哈希依赖（Supabase 默认已装在 extensions schema，此行为兜底）
create extension if not exists pgcrypto with schema extensions;

-- ============================================
-- 第 1 段 · 预览名单（只读，不改任何数据）
-- ============================================
with testers as (
  select
    u.id,
    u.email,
    u.created_at,
    coalesce(
      p.username,
      u.raw_user_meta_data ->> 'username',
      split_part(coalesce(u.email, ''), '@', 1)
    ) as uname,
    row_number() over (order by u.created_at asc, u.id asc) as n
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(coalesce(
          p.username,
          u.raw_user_meta_data ->> 'username',
          split_part(coalesce(u.email, ''), '@', 1)
        )) like '%tester%'
)
select
  t.n              as "第几个Tester",
  t.uname          as "用户名",
  t.email          as "邮箱",
  p.status         as "状态",
  '123456T' || t.n as "新密码",
  t.created_at     as "注册时间"
from testers t
left join public.profiles p on p.id = t.id
order by t.n;

-- ============================================
-- 第 2 段 · 重置密码
-- extensions.crypt('123456T'+序号, gen_salt('bf',10)) 生成 bcrypt
-- （$2a$ 成本 10），与 Supabase GoTrue 登录校验同算法，
-- 改完即刻可用新密码登录。
-- ============================================
with testers as (
  select
    u.id,
    u.email,
    u.created_at,
    coalesce(
      p.username,
      u.raw_user_meta_data ->> 'username',
      split_part(coalesce(u.email, ''), '@', 1)
    ) as uname,
    row_number() over (order by u.created_at asc, u.id asc) as n
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(coalesce(
          p.username,
          u.raw_user_meta_data ->> 'username',
          split_part(coalesce(u.email, ''), '@', 1)
        )) like '%tester%'
)
update auth.users u
set encrypted_password = extensions.crypt('123456T' || t.n,
                                           extensions.gen_salt('bf', 10)),
    updated_at = now()
from testers t
where u.id = t.id;

-- ============================================
-- 第 3 段 · 踢掉旧会话（refresh_tokens / sessions）
-- 用 try-catch 包裹：即使权限或表结构差异导致失败，
-- 也不影响第 2 段已生效的改密，脚本继续往下走。
-- ============================================
do $$
begin
  begin
    with testers as (
      select
        u.id,
        u.email,
        u.created_at,
        coalesce(
          p.username,
          u.raw_user_meta_data ->> 'username',
          split_part(coalesce(u.email, ''), '@', 1)
        ) as uname,
        row_number() over (order by u.created_at asc, u.id asc) as n
      from auth.users u
      left join public.profiles p on p.id = u.id
      where lower(coalesce(
              p.username,
              u.raw_user_meta_data ->> 'username',
              split_part(coalesce(u.email, ''), '@', 1)
            )) like '%tester%'
    )
    delete from auth.refresh_tokens as rt
    using testers t
    where rt.user_id = t.id;
  exception when others then
    raise notice '[跳过] 清理 refresh_tokens 失败：%（不影响改密；旧登录态最多再维持 1 小时）', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    with testers as (
      select
        u.id,
        u.email,
        u.created_at,
        coalesce(
          p.username,
          u.raw_user_meta_data ->> 'username',
          split_part(coalesce(u.email, ''), '@', 1)
        ) as uname,
        row_number() over (order by u.created_at asc, u.id asc) as n
      from auth.users u
      left join public.profiles p on p.id = u.id
      where lower(coalesce(
              p.username,
              u.raw_user_meta_data ->> 'username',
              split_part(coalesce(u.email, ''), '@', 1)
            )) like '%tester%'
    )
    delete from auth.sessions as s
    using testers t
    where s.user_id = t.id;
  exception when others then
    raise notice '[跳过] 清理 sessions 失败：%（不影响改密）', sqlerrm;
  end;
end $$;

-- ============================================
-- 第 4 段 · 留痕 audit_log（System 在管理台 / Terminal 可查）
-- audit_log 尚未创建（未执行过 v5 / admin 增量）时自动跳过。
-- ============================================
do $$
begin
  begin
    with testers as (
      select
        u.id,
        u.email,
        u.created_at,
        coalesce(
          p.username,
          u.raw_user_meta_data ->> 'username',
          split_part(coalesce(u.email, ''), '@', 1)
        ) as uname,
        row_number() over (order by u.created_at asc, u.id asc) as n
      from auth.users u
      left join public.profiles p on p.id = u.id
      where lower(coalesce(
              p.username,
              u.raw_user_meta_data ->> 'username',
              split_part(coalesce(u.email, ''), '@', 1)
            )) like '%tester%'
    )
    insert into public.audit_log (actor_id, action, target, detail)
    select null,
           'password_reset',
           t.uname,
           'Tester 统一改密 → 123456T' || t.n
             || '（注册序 #' || t.n || '，supabase-tester-password.sql）'
    from testers t;
  exception when others then
    raise notice '[跳过] audit_log 留痕：%（不影响改密）', sqlerrm;
  end;
end $$;

-- ============================================
-- 第 5 段 · 验证
-- 密码在库里是 bcrypt 哈希（不可逆），「新密码」列是规则推算值；
-- 以「密码更新时间」= 刚才执行的时间为准确认第 2 段已生效。
-- 最后用任一 Tester 的 用户名 + 新密码 在 /main 登录一次即可实证。
-- ============================================
with testers as (
  select
    u.id,
    u.email,
    u.created_at,
    coalesce(
      p.username,
      u.raw_user_meta_data ->> 'username',
      split_part(coalesce(u.email, ''), '@', 1)
    ) as uname,
    row_number() over (order by u.created_at asc, u.id asc) as n
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(coalesce(
          p.username,
          u.raw_user_meta_data ->> 'username',
          split_part(coalesce(u.email, ''), '@', 1)
        )) like '%tester%'
)
select
  t.n              as "第几个Tester",
  t.uname          as "用户名",
  t.email          as "邮箱",
  '123456T' || t.n as "新密码",
  u.updated_at     as "密码更新时间"
from testers t
join auth.users u on u.id = t.id
order by t.n;

-- 完成！规则速记：Tester 按注册先后编号，密码 = 123456T + 编号。
--       以后新增 Tester（用户名含 tester 即可）重跑本脚本，
--       全部编号与新密码自动重排，老账号密码不变（序号不变）。
