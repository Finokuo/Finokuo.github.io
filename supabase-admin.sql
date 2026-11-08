-- =====================================================
-- Fuo Tools · Supabase 管理端增量脚本 v3（System / Terminal 用）
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 幂等：可重复执行，不会破坏已有数据
-- 前置：已执行过 supabase-setup.sql（profiles / notes 表已存在）
--
-- 本脚本给站点加「System 管理员」能力：
--   · profiles 增加 status 列（active / banned）
--   · 用户名恰为 System 的账号获得管理权（可改任意用户的资料/状态）
--   · 普通用户无法自行解封（触发器拦截）
--   · System 可读写所有人的快捷笔记
-- =====================================================

-- 1) status 列：账号状态（active 正常 / banned 封禁）
alter table public.profiles
  add column if not exists status text not null default 'active';

alter table public.profiles drop constraint if exists profiles_status_format;
alter table public.profiles
  add constraint profiles_status_format
  check (status in ('active', 'banned'));

-- 老数据回填（防御 NULL，正常情况下默认值已覆盖）
update public.profiles set status = 'active' where status is null;

-- 2) System 管理策略：System 可以更新「任何人」的 profile
--    （select 本来就对所有人开放，无需新增）
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

-- 3) 防绕过触发器：
--    · 普通用户改自己的行时，不允许顺带把 status 改回去（封禁必须由 System 解）
--    · System 不许封禁自己 / 不许改名自己（防止管理权丢失）
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

  -- 状态变更只允许 System 操作
  if new.status is distinct from old.status and not is_system then
    raise exception 'FUO_ADMIN_ONLY: 账号状态只能由 System 修改';
  end if;

  -- System 不能封禁自己（锁死自己=失去管理权）
  if old.username = 'System' and new.status = 'banned' then
    raise exception 'FUO_SYSTEM_SELF_BAN: 不能封禁 System 账号';
  end if;

  -- System 不能改名自己（改名=丢失管理权）
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

-- 完成！接下来：
--   ① 立刻去 /main 注册用户名为 System 的账号（先到先得，注册前别公开 Terminal 地址）
--   ② 打开 /drive/tool-cluster/terminal/ 使用管理终端
