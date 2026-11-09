-- ============================================================
-- Fuo Tools · 数据库增量脚本 v4（supabase-notes.sql）
-- 内容：云笔记多行化 + 文件夹 + 收藏表 + 快捷笔记自动创建
-- 用法：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 说明：可重复执行（幂等）。旧 notes 表当前为空，直接重建无数据损失。
-- ============================================================

-- ============================================
-- 1) 文件夹表 folders
-- ============================================
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists folders_user_name
  on public.folders (user_id, name);
create index if not exists folders_user_idx
  on public.folders (user_id);

alter table public.folders enable row level security;

drop policy if exists "folders_select_own" on public.folders;
create policy "folders_select_own" on public.folders
  for select using (auth.uid() = user_id);

drop policy if exists "folders_insert_own" on public.folders;
create policy "folders_insert_own" on public.folders
  for insert with check (auth.uid() = user_id);

drop policy if exists "folders_update_own" on public.folders;
create policy "folders_update_own" on public.folders
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "folders_delete_own" on public.folders;
create policy "folders_delete_own" on public.folders
  for delete using (auth.uid() = user_id);

-- System 全权（与 notes / profiles 管理策略同款）
drop policy if exists "folders_all_system_admin" on public.folders;
create policy "folders_all_system_admin" on public.folders
  for all using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  );

-- ============================================
-- 2) notes 表重建：一人多笔记 + 文件夹 + 快捷笔记标记
--    （旧表每用户仅一行且当前无数据，直接重建）
-- ============================================
drop table if exists public.notes cascade;

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  folder_id  uuid references public.folders (id) on delete set null,
  title      text not null default '未命名笔记',
  content    text not null default '',
  is_quick   boolean not null default false,   -- 快捷笔记：置顶、不可删除
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_user_idx   on public.notes (user_id);
create index if not exists notes_folder_idx on public.notes (folder_id);
-- 每人至多一条快捷笔记（部分唯一索引）
create unique index if not exists notes_one_quick_per_user
  on public.notes (user_id) where is_quick;

alter table public.notes enable row level security;

drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own" on public.notes
  for select using (auth.uid() = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own" on public.notes
  for insert with check (auth.uid() = user_id and is_quick is not null);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own" on public.notes
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 普通用户只能删「非快捷笔记」；快捷笔记由下方触发器无条件保护
drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own" on public.notes
  for delete using (auth.uid() = user_id and is_quick = false);

drop policy if exists "notes_all_system_admin" on public.notes;
create policy "notes_all_system_admin" on public.notes
  for all using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  );

-- updated_at 自动更新（函数 set_updated_at_fn 已在 setup.sql v1 定义；
-- 若跳过 setup 直接执行本脚本，这里兜底补建）
create or replace function public.set_updated_at_fn()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at_fn();

-- 快捷笔记防删触发器：对所有人（含 System）无条件拦截
create or replace function public.guard_quick_note()
returns trigger language plpgsql as $$
begin
  if old.is_quick then
    raise exception 'FUO_QUICK_PINNED: 快捷笔记无法删除';
  end if;
  return old;
end;
$$;

drop trigger if exists notes_guard_quick on public.notes;
create trigger notes_guard_quick
  before delete on public.notes
  for each row execute function public.guard_quick_note();

-- ============================================
-- 3) 收藏表 favorites（工具 / 笔记）
--    kind = 'tool' → ref = 工具 slug（json/color/…）
--    kind = 'note' → ref = 笔记 uuid
--    title 为冗余显示名（笔记改名时由前端同步更新）
-- ============================================
create table if not exists public.favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('tool', 'note')),
  ref        text not null,
  title      text not null default '',
  created_at timestamptz not null default now()
);

-- 同一对象只收藏一次
create unique index if not exists favorites_unique
  on public.favorites (user_id, kind, ref);
create index if not exists favorites_user_idx
  on public.favorites (user_id);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites
  for select using (auth.uid() = user_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists "favorites_update_own" on public.favorites;
create policy "favorites_update_own" on public.favorites
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites
  for delete using (auth.uid() = user_id);

drop policy if exists "favorites_all_system_admin" on public.favorites;
create policy "favorites_all_system_admin" on public.favorites
  for all using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.username = 'System')
  );

-- ============================================
-- 4) 存量用户补建快捷笔记（Finokuo / System / …）
-- ============================================
insert into public.notes (user_id, title, is_quick)
select p.id, '快捷笔记', true
from public.profiles p
where not exists (
  select 1 from public.notes n
  where n.user_id = p.id and n.is_quick = true
);

-- ============================================
-- 5) 新用户注册 → 自动创建快捷笔记
--    （独立触发器，不影响原 handle_new_user 的用户名逻辑）
-- ============================================
create or replace function public.handle_new_user_notes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notes (user_id, title, is_quick)
  values (new.id, '快捷笔记', true);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_notes on auth.users;
create trigger on_auth_user_created_notes
  after insert on auth.users
  for each row execute function public.handle_new_user_notes();

-- 完成！现在支持：多笔记 · 文件夹 · 搜索 · 收藏（工具/笔记）· 快捷笔记保护
-- 仪表盘快捷笔记 widget 读写 is_quick=true 那一行，与云笔记页完全打通
