-- =====================================================
-- Fuo Tools · Supabase 数据库初始化脚本 v2（用户名版）
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 幂等：可重复执行，不会破坏已有数据
-- 新增：profiles 用户名表（注册带用户名 / 用户名登录 / 修改用户名）
-- =====================================================

-- ============================================
-- 第一部分 · profiles 用户名表（本次新增，必须执行）
-- ============================================

-- 1) 用户名表：一行对应一个账号
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null unique,
  email      text,
  bio        text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) 用户名格式约束：3-20 位，字母 / 数字 / 下划线
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[A-Za-z0-9_]{3,20}$');

-- 3) 开启行级安全（RLS）
alter table public.profiles enable row level security;

-- 4) RLS 策略
--    select 对所有人开放：登录页需要在「未登录」状态下
--    用用户名反查邮箱（profiles 里只有用户名和邮箱，不含敏感数据）
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

--    插入 / 修改：只能操作自己的那一行
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5) 新用户注册时自动创建同名 profile（读注册时填写的用户名；
--    若没填或撞名，自动降级为 邮箱前缀 / 邮箱前缀+序号 / user_xxx）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base  text;
  final text;
  n     int;
begin
  base := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-zA-Z0-9_]', '', 'g'))
  );
  if base is null or char_length(base) < 3 then
    base := 'user_' || left(new.id::text, 8);
  end if;
  final := base;
  n := 1;
  while exists (select 1 from public.profiles where username = final) loop
    n := n + 1;
    final := base || n::text;
  end loop;
  insert into public.profiles (id, username, email)
  values (new.id, final, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6) 老用户回填：给「执行本脚本之前」注册的账号补一个 profile
--    （默认用邮箱前缀当用户名，重名自动加序号，之后可自行修改）
do $$
declare
  u     record;
  base  text;
  final text;
  n     int;
begin
  for u in select id, email, raw_user_meta_data from auth.users loop
    continue when exists (select 1 from public.profiles where id = u.id);
    base := coalesce(
      nullif(u.raw_user_meta_data ->> 'username', ''),
      lower(regexp_replace(split_part(coalesce(u.email, 'user'), '@', 1), '[^a-zA-Z0-9_]', '', 'g'))
    );
    if base is null or char_length(base) < 3 then
      base := 'user_' || left(u.id::text, 8);
    end if;
    final := base;
    n := 1;
    while exists (select 1 from public.profiles where username = final) loop
      n := n + 1;
      final := base || n::text;
    end loop;
    insert into public.profiles (id, username, email) values (u.id, final, u.email);
  end loop;
end $$;

-- 7) updated_at 自动更新
--    ⚠ 函数必须先于触发器创建（PostgreSQL 要求 create trigger 时函数已存在）
create or replace function public.set_updated_at_fn()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at_fn();

-- ============================================
-- 第二部分 · 云笔记（多笔记 + 文件夹）+ 收藏表（v4）
-- ============================================

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


-- ============================================
-- 第三部分 · System 管理端（v3 增量，Terminal 用）
-- ============================================

-- 1) status 列：账号状态（active 正常 / banned 封禁）
alter table public.profiles
  add column if not exists status text not null default 'active';

alter table public.profiles drop constraint if exists profiles_status_format;
alter table public.profiles
  add constraint profiles_status_format
  check (status in ('active', 'banned'));

update public.profiles set status = 'active' where status is null;

-- 2) System 管理策略：System 可以更新「任何人」的 profile
--    ⚠ 用户名区分大小写：必须是恰好 "System"
drop policy if exists "profiles_update_system_admin" on public.profiles;
create policy "profiles_update_system_admin" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'System'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'System'
    )
  );

-- 3) 防绕过触发器：普通用户不能自行解封；System 不能封禁/改名自己
create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_system boolean;
begin
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.username = 'System'
  ) into is_system;

  if new.status is distinct from old.status and not is_system then
    raise exception 'FUO_ADMIN_ONLY: 账号状态只能由 System 修改';
  end if;

  if old.username = 'System' and new.status = 'banned' then
    raise exception 'FUO_SYSTEM_SELF_BAN: 不能封禁 System 账号';
  end if;

  if old.username = 'System' and new.username is distinct from old.username then
    raise exception 'FUO_SYSTEM_RENAME: System 账号不可改名';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_changes on public.profiles;
create trigger profiles_guard_changes
  before update on public.profiles
  for each row execute function public.guard_profile_changes();

-- 4) notes 管理策略：System 可读写所有人的快捷笔记
drop policy if exists "notes_all_system_admin" on public.notes;
create policy "notes_all_system_admin" on public.notes
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'System'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'System'
    )
  );

-- 完成！现在支持：注册时填用户名 · 用户名+密码登录 · 工作台修改用户名
--              · System 管理员（Terminal）封禁/解封/改名/管理笔记


-- ============================================
-- 第四部分 · v0.7.0 增量：回收站 / 公告 / 操作日志
-- （与 supabase-v5.sql 内容一致；老库可单独执行 v5 增量）
-- ============================================

-- 1) notes 软删除列（回收站）
alter table public.notes
  add column if not exists deleted_at timestamptz default null;

create index if not exists notes_deleted_idx
  on public.notes (user_id) where deleted_at is not null;

-- 2) 公告表（System 在 Terminal 发布，全站登录用户可见）
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

-- 3) Terminal 操作日志（仅 System 可写可读）
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null,
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

-- 4) 个人简介（公开主页 /u/?u=<用户名>）
alter table public.profiles
  add column if not exists bio text not null default '';

-- 完成！现在支持：注册登录用户名 · 云笔记多行+文件夹+收藏 · System 管理端
--              · 回收站（软删除）· 全站公告 · Terminal 操作日志 · 公开主页简介
