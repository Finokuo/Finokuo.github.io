# Fuo Tools · 部署与配置指南

分层式纯静态站点：**主页**（`/main`）+ **仪表盘**（`/drive`）+ 根路径自动分流。
后端由 Supabase 提供（数据库 / 认证 / 云同步），前端零服务器，完美适配 GitHub Pages。

**设计语言**：暗色默认 · 亮色可选（导航栏 ☀/🌙 一键切换，自动记忆）· 青色极光 · 低调但强。

```
线上地址结构（Finokuo.github.io）
├── finokuo.github.io/          → 根入口：已登录跳 /drive/，未登录跳 /main/
├── finokuo.github.io/main/     → 主页（暗色落地页 + 登录/注册）
└── finokuo.github.io/drive/    → 工作台（登录后可见）
```

## 一、仓库目录结构

把两个 ZIP 解压到 **同一个** 仓库（名为 `Finokuo.github.io`）的根目录：

```
Finokuo.github.io/        ← GitHub 仓库名必须是这个（用户主页站点）
├── index.html            ← 来自 main 包（root/index.html，记得移到根目录）
├── supabase-setup.sql    ← 数据库脚本（不用部署，仅控制台执行用）
├── main/
│   ├── index.html
│   └── assets/
│       ├── css/style.css
│       ├── js/{config.js, theme.js, fx.js, app.js}
│       └── vendor/supabase.min.js   ← SDK 已本地打包，不依赖 CDN！
└── drive/
    ├── index.html
    └── assets/
        ├── css/style.css
        ├── js/{config.js, theme.js, fx.js, app.js}
        └── vendor/supabase.min.js   ← 同上
```

> ⚠️ main 包里的 `root/index.html` 解压后请**移动到仓库根目录**变成
> `Finokuo.github.io/index.html`，这样访问根域名才会自动分流。
>
> ⚠️ `assets/vendor/supabase.min.js` 是注册登录的核心依赖，**务必随仓库一起上传**，
> 缺了它会提示「SDK 未就绪」。

## 二、Supabase 配置（3 步）

1. **执行数据库脚本**：Supabase 控制台 → SQL Editor：
   - 执行过旧版：只需粘贴 **`supabase-notes.sql`**（增量 v4：云笔记多行化 + 文件夹 + 收藏表）→ Run ✅
   - 全新项目：粘贴 `supabase-setup.sql`（已合并全部版本）→ Run ✅
2. **（必须）关闭邮箱验证，注册即登录**：
   Authentication → Sign In / Providers → **取消勾选 Confirm email** → Save。
   - 注册流程已完全适配「无验证邮件」模式：注册前只查用户名/邮箱是否被占用，
     查重通过直接建号进工作台，全程不发、不等任何验证邮件。
   - 若保持开启：signUp 拿不到 session，注册页会提示你去关闭或手动确认用户。
   - 提醒：曾用「已开启验证」注册过的邮箱会留下「Waiting for verification」僵尸账号
     占住邮箱（且在 profiles 表无记录、预检查不到），需到 Authentication → Users
     手动 Delete user 后才能重新注册。
3. **API Key**：两个页面的 `assets/js/config.js` 已填好 Publishable Key（可公开的那把），无需改动。
   - ⚠️ **`sb_secret_` 开头的 Secret Key 永远不要放进前端！** 它能绕过所有安全策略。
     **强烈建议立刻去 Settings → API Keys → Rotate 轮换一次**（它曾在聊天中出现过，视为已泄露）。

## 三、注册注意事项（重要）

- Supabase 会拒绝 `example.com`、`@finokuo.dev` 这类**不可信/一次性邮箱域名**——
  用户用 **QQ / 163 / Gmail / Outlook 等真实邮箱**注册即可正常通过。
- 如果注册报「触发频控」，是该小时邮件额度用尽（免费档限制），一小时后自动恢复；
  关闭 Confirm email 后可彻底绕开这个限制。

## 四、本地预览

```bash
# 在解压后的目录里
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/root/（体验跳转）
# 或直接 http://localhost:8080/main/、http://localhost:8080/drive/
```

## 五、部署到 GitHub Pages

```bash
git init
git add -A
git commit -m "Fuo Tools v0.3 · 亮色模式 + 弹窗修复 + 圆点静态化"
git remote add origin https://github.com/Finokuo/Finokuo.github.io.git
git push -u origin main
```

仓库 **Settings → Pages** → Source 选 `Deploy from a branch` → Branch 选 `main` / root → Save。
一两分钟后访问 https://finokuo.github.io 即可 🎉

## 六、注册/登录体验流程

1. 访问 `finokuo.github.io` → 自动跳到 `/main/` 主页
2. 点击「免费注册」→ 填邮箱密码 → 注册成功进入 `/drive/`（若开了邮箱验证则先去邮箱确认）
3. 下次访问根域名 → 已登录，直接进 `/drive/`；未登录 → 进 `/main/`
4. 工作台「快捷笔记」支持**自动云同步**（防抖 900ms 保存到 Supabase）

## 七、路线图

- `/codetools/<工具>` 开发者工具系列（JSON、颜色、密码…从现有资产迁移）
- 收藏系统 / 最近使用云同步 / 一键分享短链
- GitHub OAuth 登录

## 附：文件说明

| 文件 | 作用 |
|------|------|
| `root/index.html` | 根路径秒级分流（读 localStorage 判断登录态） |
| `main/index.html` | 主页：Hero / 功能 / 工具一览 / 三步开始 / CTA / 登录注册弹窗 |
| `drive/index.html` | 工作台：问候、快捷笔记（云同步）、工具入口、最近使用、账号 |
| `assets/js/config.js` | Supabase 地址 + Publishable Key + 路径配置（预览环境自动适配） |
| `assets/js/theme.js` | 亮/暗主题切换与记忆（localStorage · key `fu-theme`） |
| `assets/vendor/supabase.min.js` | Supabase JS SDK（UMD 本地打包，约 220KB，无 CDN 依赖） |
| `supabase-setup.sql` | 建表 + RLS 策略 + updated_at 触发器（幂等可重复执行） |
