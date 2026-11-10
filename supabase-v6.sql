-- =====================================================
-- Fuo Tools · Supabase 增量脚本 v6（v0.8.0）
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 幂等：可重复执行，不会破坏已有数据
--
-- 内容：
--   1) notes.pinned      —— 笔记置顶（列表顶部常驻）
--   2) notes.is_public   —— 公开笔记分享（/n/?id=<uuid> 只读页）
--   3) note_versions     —— 笔记版本历史（每篇滚动保留 20 版，可恢复）
--   4) office_data       —— 办公集通用数据表（待办清单 / 习惯打卡云同步）
-- =====================================================

-- ============================================
-- 1) notes 置顶列
-- ============================================
alter table public.notes
  add column if not exists pinned boolean not null default false;

create index if not exists notes_pinned_idx
  on public.notes (user_id) where pinned = true;

-- ============================================
-- 2) notes 公开分享列 + 公开读策略
--    is_public = true 的笔记：任何人（含未登录）可读（分享页 /n/?id=）
--    仅本人可切换该开关；软删除（deleted_at）后即使公开也不可读
-- ============================================
-- 保险：确保软删除列存在（v5 已执行过的会自动跳过）
alter table public.notes
  add column if not exists deleted_at timestamptz default null;

alter table public.notes
  add column if not exists is_public boolean not null default false;

-- 公开读策略（与本人策略 OR 叠加，不影响私有笔记）
drop policy if exists "notes_select_public" on public.notes;
create policy "notes_select_public" on public.notes
  for select using (is_public = true and deleted_at is null);

-- ============================================
-- 3) 笔记版本历史表 note_versions
--    前端在编辑过程中定期快照（同一篇 ≥10 分钟才存一版），
--    每篇滚动保留 20 版；删除笔记时级联清理
-- ============================================
create table if not exists public.note_versions (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default '',
  content    text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists note_versions_note_idx
  on public.note_versions (note_id, created_at desc);

alter table public.note_versions enable row level security;

drop policy if exists "note_versions_owner_all" on public.note_versions;
create policy "note_versions_owner_all" on public.note_versions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================
-- 4) 办公集数据表 office_data
--    一张表喂饱整个办公集：user_id + kind 区分数据类型，
--    payload 为 JSON 载荷（todo = 待办清单 / habit = 习惯打卡）。
--    以后新增办公工具（kind 新值）无需再动数据库。
-- ============================================
create table if not exists public.office_data (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 每人每种 kind 一行（前端 upsert 依赖该唯一约束）
create unique index if not exists office_data_uniq
  on public.office_data (user_id, kind);

alter table public.office_data enable row level security;

drop policy if exists "office_data_owner_all" on public.office_data;
create policy "office_data_owner_all" on public.office_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 完成！执行后即解锁：笔记置顶 · 公开分享链接 · 版本历史 · 办公集云同步
-- （未执行本脚本时：置顶/分享/版本历史自动隐藏或降级提示，
--   办公集以「仅本机」模式运行，其余功能不受影响）
