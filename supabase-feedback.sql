-- =====================================================
-- Fuo Tools · Supabase 增量脚本：全站反馈表（web v0.9.2 新增）
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴全部 → Run
-- 幂等：可重复执行，不会破坏已有数据
-- 前置：已执行过 supabase-setup.sql（profiles 表已存在）
--
-- 本脚本给站点加「用户反馈」能力：
--   · feedback 表：任何人（含未登录游客）可提交一条反馈
--   · 普通用户 / 游客：只能写，不能读别人的反馈（无 select 权）
--   · System：可查看全部反馈、可删除（配合管理台「反馈」面板）
--   · 登录用户 60 秒内限发一条（数据库层防刷）；游客由前端节流
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

-- 2a) 所有人（游客 + 登录用户）可插入
--     · 内容长度 1~1000
--     · 登录用户 60 秒内限发一条（数据库层防刷；游客由前端节流兜底）
drop policy if exists "feedback_insert_anyone" on public.feedback;
create policy "feedback_insert_anyone" on public.feedback
  for insert to anon, authenticated
  with check (
    char_length(content) between 1 and 1000
    and (
      auth.uid() is null
      or not exists (
        select 1 from public.feedback f
        where f.user_id = auth.uid()
          and f.created_at > now() - interval '60 seconds'
      )
    )
  );

-- 2b) 仅 System 可查看全部反馈
drop policy if exists "feedback_select_system" on public.feedback;
create policy "feedback_select_system" on public.feedback
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'System'
    )
  );

-- 2c) 仅 System 可删除反馈（管理台「反馈」面板 / Terminal）
drop policy if exists "feedback_delete_system" on public.feedback;
create policy "feedback_delete_system" on public.feedback
  for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'System'
    )
  );

-- 3) 显式授权（Supabase 默认已授予，写明以防环境差异）
grant insert on public.feedback to anon, authenticated;
grant select, delete on public.feedback to authenticated;

-- 完成！接下来：
--   ① 全站右下角出现「反馈」按钮（web v0.9.2 已内置，无需其他配置）
--   ② System 登录 /drive/admin/ → 新增「反馈」面板即可查看 / 删除
--   ③ 所有删除动作自动写 audit_log 留痕
