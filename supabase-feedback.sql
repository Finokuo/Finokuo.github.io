-- =====================================================
-- Fuo Tools · Supabase 增量脚本：全站反馈表（web v0.9.6 修复版）
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 幂等：可重复执行，不会破坏已有数据
-- 前置：已执行过 supabase-setup.sql（profiles 表已存在）
--
-- 本脚本给站点加「用户反馈」能力：
--   · feedback 表：任何人（含未登录游客）可提交一条反馈
--   · 普通用户 / 游客：只能写，不能读别人的反馈（无 select 权）
--   · System：可查看全部反馈、可删除（配合管理台「反馈」面板）
--   · 登录用户 60 秒内限发一条（数据库层防刷）；游客由前端节流
--
-- v0.9.6 关键修复：提交反馈报
--   infinite recursion detected in policy for relation "feedback"（42P17）
--   根因：旧版把 60 秒限流写成「在 feedback 自己的插入策略里
--         not exists 查 feedback 自己」——PostgreSQL 行级安全（RLS）
--         不允许策略引用所在表自身，求值时立即检测到递归。
--   修法（Supabase 官方推荐的同表检查模式）：把同表查询包进
--   security definer 函数（以表所有者身份执行、绕过 RLS），
--   策略里只调用函数；System 身份判断同理抽成 is_system() 复用。
-- =====================================================

-- 1) 反馈表
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null, -- 游客为 null
  username text,                                              -- 提交时的用户名（游客为 null，冗余存储便于直读）
  kind text not null default 'suggestion',                    -- bug / suggestion / other
  content text not null,                                      -- 正文（1~1000 字，策略层校验）
  page text,                                                  -- 提交页路径，如 /drive/tool-cluster/notes/
  user_agent text,                                            -- 浏览器 UA（截断存储，便于定位兼容性问题）
  created_at timestamptz not null default now()
);

-- 内容长度 / 类型取值约束（幂等：存在则跳过）
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'feedback_kind_check'
  ) then
    alter table public.feedback
      add constraint feedback_kind_check check (kind in ('bug', 'suggestion', 'other'));
  end if;
end $$;

-- 索引：管理台按时间倒序分页
create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);

-- 2) RLS
alter table public.feedback enable row level security;

-- 2-0a) 辅助函数：当前登录用户是否 System
--       security definer = 以函数所有者身份执行，查询 profiles 不受
--       profiles 表 RLS 影响（策略求值链上彻底断开递归可能）
create or replace function public.is_system()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.username = 'System'
  );
$$;

-- 2-0b) 辅助函数：登录用户 60 秒限流检查
--       【本次修复核心】查 feedback 自己，必须放在 security definer
--       函数里执行（所有者身份绕过 feedback 自身 RLS），
--       直接写进策略会触发 42P17 无限递归。
--       游客（auth.uid() 为 null）不受数据库层限流（前端节流兜底）。
create or replace function public.can_submit_feedback()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is null
    or not exists (
      select 1 from public.feedback f
      where f.user_id = (select auth.uid())
        and f.created_at > now() - interval '60 seconds'
    );
$$;

-- 函数执行权限（PostgreSQL 默认已授 PUBLIC，写明以防环境差异）
grant execute on function public.is_system()         to anon, authenticated;
grant execute on function public.can_submit_feedback() to anon, authenticated;

-- 2a) 所有人（游客 + 登录用户）可插入
--     · 内容长度 1~1000
--     · 限流走 can_submit_feedback()（不再内联查询本表！）
--     · (select fn()) 写法让函数每次语句只求值一次（不走每行，
--       Supabase RLS 性能规范推荐写法）
drop policy if exists "feedback_insert_anyone" on public.feedback;
create policy "feedback_insert_anyone" on public.feedback
  for insert to anon, authenticated
  with check (
    char_length(content) between 1 and 1000
    and (select public.can_submit_feedback())
  );

-- 2b) 仅 System 可查看全部反馈
drop policy if exists "feedback_select_system" on public.feedback;
create policy "feedback_select_system" on public.feedback
  for select to authenticated
  using ((select public.is_system()));

-- 2c) 仅 System 可删除反馈（管理台「反馈」面板 / Terminal）
drop policy if exists "feedback_delete_system" on public.feedback;
create policy "feedback_delete_system" on public.feedback
  for delete to authenticated
  using ((select public.is_system()));

-- 3) 显式授权（Supabase 默认已授予，写明以防环境差异）
grant insert on public.feedback to anon, authenticated;
grant select, delete on public.feedback to authenticated;

-- 完成！接下来：
--   ① 全站右下角出现「反馈」按钮（web v0.9.2 已内置，无需其他配置）
--   ② System 登录 /drive/admin/ → 新增「反馈」面板即可查看 / 删除
--   ③ 所有删除动作自动写 audit_log 留痕
--
-- 已执行过旧版（v0.9.2）本脚本？直接整段重跑本文件即可：
--   · 表 / 约束 / 索引全部幂等，已有反馈数据不受影响
--   · 三条策略会先 drop 再重建为修复版，重跑后提交立即恢复正常
