-- =====================================================
-- Fuo Tools · Supabase 增量脚本 v5（v0.7.0）
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 幂等：可重复执行，不会破坏已有数据
--
-- 内容：
--   1) notes.deleted_at —— 回收站（软删除，前端 30 天自动清理）
--   2) announcements   —— 全站公告（System 在 Terminal 里 announce 发布）
--   3) audit_log       —— Terminal 操作日志（ban / rename / 公告等自动记录）
--   4) profiles.bio    —— 个人简介（公开主页 /u/?u=<用户名> 展示）
-- =====================================================

-- ============================================
-- 1) notes 软删除列（回收站）
--    deleted_at 为空 = 在册；非空 = 已进回收站，30 天后前端自动清理
-- ============================================
alter table public.notes
  add column if not exists deleted_at timestamptz default null;

create index if not exists notes_deleted_idx
  on public.notes (user_id) where deleted_at is not null;

-- ============================================
-- 2) 公告表 announcements
--    所有登录用户可读最新一条（页面顶部横幅，可关闭并记忆已读）
--    仅 System 可发布 / 删除
-- ============================================
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid references auth.users (id) on delete set null,
  content    text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

drop policy if exists "announcements_select_auth" on public.announcements;
create policy "announcements_select_auth" on public.announcements
  for select using (auth.role() = 'authenticated');

drop policy if exists "announcements_insert_system" on public.announcements;
create policy "announcements_insert_system" on public.announcements
  for insert with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  );

drop policy if exists "announcements_delete_system" on public.announcements;
create policy "announcements_delete_system" on public.announcements
  for delete using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  );

-- ============================================
-- 3) 操作日志表 audit_log（Terminal 命令自动留痕）
--    仅 System 可写入 / 查看
-- ============================================
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null,          -- ban / unban / rename / setnote / announce / delannounce / purge …
  target     text not null default '',
  detail     text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists audit_created_idx
  on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_insert_system" on public.audit_log;
create policy "audit_insert_system" on public.audit_log
  for insert with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  );

drop policy if exists "audit_select_system" on public.audit_log;
create policy "audit_select_system" on public.audit_log
  for select using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  );

-- ============================================
-- 4) profiles.bio —— 个人简介（公开主页 /u/?u=<用户名>）
--    profiles 表本身已公开可读（profiles_select_all），
--    bio 随之公开；不填则为空串，主页显示占位文案
-- ============================================
alter table public.profiles
  add column if not exists bio text not null default '';

-- 完成！执行后即解锁：回收站 · 全站公告 · Terminal 操作日志 · 公开主页简介
-- （未执行本脚本时：回收站自动降级为直接删除，公告与日志静默不可用，
--   主页简介占位显示，不影响其他功能）
