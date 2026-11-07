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
-- 第二部分 · 快捷笔记表（仪表盘「快捷笔记」widget）
-- ============================================

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own" on public.notes
  for select using (auth.uid() = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own" on public.notes
  for insert with check (auth.uid() = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own" on public.notes
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own" on public.notes
  for delete using (auth.uid() = user_id);

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at_fn();

-- 完成！现在支持：注册时填用户名 · 用户名+密码登录 · 工作台修改用户名
