-- ============================================================
-- Fuo Tools · supabase-v7.sql（v0.10.0 增量 · 幂等可重复执行）
--
-- 新增：用户反馈表 feedback
--   · 游客（anon）与登录用户（authenticated）都可以提交
--     —— 游客也能报告「注册不了」这类问题
--   · 内容长度 1-500 字（数据库 CHECK + 策略双重限制，防堆积）
--   · 仅 System 可查看 / 删除（RLS）
--   · 可选联系方式（QQ / 邮箱，≤60 字）与来源页面，便于回访
--
-- 使用：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- ============================================================

-- 1) 反馈表
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete set null,
  username   text,
  contact    text,
  content    text not null check (char_length(btrim(content)) between 1 and 500),
  page       text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- 按时间倒序查看的索引
create index if not exists feedback_created_idx
  on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- 2) 提交：游客 + 登录用户（内容长度在策略层再限一次）
drop policy if exists "feedback_insert_any" on public.feedback;
create policy "feedback_insert_any" on public.feedback
  for insert to anon, authenticated
  with check (char_length(btrim(content)) between 1 and 500);

-- 3) 查看：仅 System
drop policy if exists "feedback_select_system" on public.feedback;
create policy "feedback_select_system" on public.feedback
  for select to authenticated using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  );

-- 4) 删除：仅 System
drop policy if exists "feedback_delete_system" on public.feedback;
create policy "feedback_delete_system" on public.feedback
  for delete to authenticated using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  );

-- 完成！网页端侧栏「反馈」按钮 + 主页页脚入口 + 管理台「反馈」标签页
--        （v0.10.0 上线，执行本文件后即可使用）
