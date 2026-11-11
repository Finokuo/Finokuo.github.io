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

1. **执行数据库脚本**：Supabase 控制台 → SQL Editor → 粘贴 `supabase-setup.sql` 全部内容 → Run ✅
2. **（推荐）关闭邮箱验证，注册即登录**：
   Authentication → Sign In / Providers → **取消勾选 Confirm email** → Save。
   - 不关也可以：注册页会提示用户去邮箱点确认链接。
   - 注意：免费档**每小时只能发少量验证邮件**，公测期建议直接关掉，避免用户被限流卡住。
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

## 七、功能总览（v0.8.1）

- **16 款本地工具**：JSON / 颜色 / 密码 / 文本统计 / 时间戳 / Base64 / UUID / Diff / 正则测试器 / 二维码 / 哈希 / URL / 图片压缩 / **JWT 解码器 / 进制转换（BigInt）/ Lorem 占位文本**
- **办公集（独立工作区）**：**AI 管理大师（v0.8.1 全新）**——扫描设备上的 AI（PC / iPhone / Android 分平台探测）、任务一键派发（指令自动进剪贴板 + 依次唤起目标 AI）、结果回填归档，内置豆包/通义/Kimi/DeepSeek/ChatGPT/Claude 等 14 个条目 + 自定义 AI 登记；**待办清单**（优先级/截止日/今日视图）· **习惯打卡**（GitHub 式热力图/连续天数）· **番茄钟**（专注统计/桌面通知）；本地优先 + office_data 云同步
- **云笔记增强**：**置顶** · **公开分享链接 `/n/?id=`**（任何人可读）· **单篇导出 .md / 全部导出 ZIP（零依赖自实现）** · **版本历史（约 10 分钟一版，滚动 20 版可恢复）** · 拖拽笔记到文件夹
- **主题色系统**：6 种强调色（青/橙/粉/紫/绿/金）× 亮暗模式，设置页一键切换全站生效
- **Ctrl+K 命令面板**：搜工具 / 页面 / 笔记 / 办公工具 / 操作 + **笔记全文搜索（内容命中带上下文片段）**
- **工具热度榜**：目录页「常用」置顶（仅本机记录）
- **工具配置分享**：密码生成器 / 颜色工具参数进 URL，复制链接即还原配置
- **独立回收站页**：剩余天数进度条 · 批量恢复 · 清空
- **图形化管理台** `/drive/admin/`（System 专属）：用户表格（搜索/封禁/改名）· 公告编辑器 · 审计日志时间线；**v0.8.1 身份验证健壮化**——查询失败自动重试 + 超时竞争，绝不把网络故障误判成 403；错误面板显示具体原因与当前登录身份，可一键重新验证
- **头像直达公开主页（v0.8.1）**：任意页面点击侧栏头像即进入 `/u/?u=自己`
- **导出账号数据**：设置页一键导出全部笔记/收藏/资料为 JSON 备份
- 公告系统 · 公开用户主页 · 修改密码/简介 · Terminal（新 `admin` 命令直达图形台）
- **PWA 可安装** · 收藏系统 · 最近使用 · 亮暗主题 · 侧栏折叠 · System 账号封禁体系

> v0.8.0 修复：进入工作台侧栏先显示邮箱再切用户名的闪烁（现在直接展示用户名）
> v0.8.1 修复：管理台把「查询失败」误判为 403，导致 System 本人被拒之门外的问题

## 附：文件说明

| 文件 | 作用 |
|------|------|
| `root/index.html` | 根路径秒级分流（读 localStorage 判断登录态） |
| `main/index.html` | 主页：Hero / 功能 / 工具一览 / 三步开始 / CTA / 登录注册弹窗 |
| `drive/index.html` | 工作台：问候、快捷笔记（云同步）、工具入口（16+3）、办公三件套卡 |
| `assets/js/config.js` | Supabase 地址 + Publishable Key + 路径配置（预览环境自动适配） |
| `assets/js/theme.js` | 亮/暗主题 + 主题色（v0.8）切换与记忆 |
| `assets/css/accent.css` | 6 种主题色变量覆盖层（v0.8 新增） |
| `assets/vendor/supabase.min.js` | Supabase JS SDK（UMD 本地打包，约 220KB，无 CDN 依赖） |
| `drive/office/` | 办公集：目录页 + 待办清单 + 习惯打卡 + 番茄钟 + 共享数据层 |
| `drive/recycle/` | 独立回收站页（v0.8） |
| `drive/n/index.html` | 公开笔记分享页（`/n/?id=<笔记ID>`，匿名可读） |
| `drive/admin/` | 图形化管理台（System 专属，v0.8） |
| `supabase-setup.sql` | 建表 + RLS 策略 + 触发器（全量，幂等可重复执行） |
| `supabase-notes.sql` | 云笔记增表（notes/folders/notes collections） |
| `supabase-admin.sql` | System 管理员增量（profiles.status + 触发器） |
| `supabase-v5.sql` | v0.7 增量：回收站软删除 / 公告表 / 操作日志 / 用户简介（幂等） |
| `supabase-v6.sql` | **v0.8 增量**：笔记置顶 / 公开分享 / 版本历史 / 办公集云同步（幂等） |
| `drive/manifest.json` + `drive/sw.js` | PWA：安装清单 + 离线缓存壳（仅 https 生效） |
| `drive/u/index.html` | 公开用户主页（`/u/?u=用户名`，未登录可看） |
