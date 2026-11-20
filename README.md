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
├── _headers              ← v0.9.1 新增：安全响应头（GitHub Pages 不解析，迁移 CF/Netlify 自动生效）
├── robots.txt + sitemap.xml ← v0.9.1 新增：SEO 爬虫规则与站点地图
├── assets/og-cover.png   ← v0.9.1 新增：社交分享封面图（1200×630）
├── main/
│   ├── index.html
│   ├── terms.html        ← v0.9.1 新增：服务条款
│   ├── privacy.html      ← v0.9.1 新增：隐私政策
│   └── assets/
│       ├── css/style.css
│       ├── js/{config.js, theme.js, fx.js, app.js}
│       └── vendor/supabase.min.js   ← SDK 已本地打包，不依赖 CDN！
├── fuotool/              ← v0.9 新增：Fuo Tool 桌面版下载页（AI 管理大师引导）
│   └── index.html
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

## 七、功能总览（v0.9.5）

- **16 款本地工具**：JSON / 颜色 / 密码 / 文本统计 / 时间戳 / Base64 / UUID / Diff / 正则测试器 / 二维码 / 哈希 / URL / 图片压缩 / **JWT 解码器 / 进制转换（BigInt）/ Lorem 占位文本**
- **办公集（新工作区）**：**待办清单**（优先级/截止日/今日视图）· **习惯打卡**（GitHub 式热力图/连续天数）· **番茄钟**（专注统计/桌面通知）；本地优先 + office_data 云同步
- **云笔记增强**：**置顶** · **公开分享链接 `/n/?id=`**（任何人可读）· **单篇导出 .md / 全部导出 ZIP（零依赖自实现）** · **版本历史（约 10 分钟一版，滚动 20 版可恢复）** · 拖拽笔记到文件夹
- **主题色系统**：6 种强调色（青/橙/粉/紫/绿/金）× 亮暗模式，设置页一键切换全站生效
- **Ctrl+K 命令面板**：搜工具 / 页面 / 笔记 / 办公工具 / 操作 + **笔记全文搜索（内容命中带上下文片段）**
- **工具热度榜**：目录页「常用」置顶（仅本机记录）
- **工具配置分享**：密码生成器 / 颜色工具参数进 URL，复制链接即还原配置
- **独立回收站页**：剩余天数进度条 · 批量恢复 · 清空
- **图形化管理台** `/drive/admin/`（System 专属）：用户表格（搜索/封禁/改名）· 公告编辑器 · 审计日志时间线
- **导出账号数据**：设置页一键导出全部笔记/收藏/资料为 JSON 备份
- 公告系统 · 公开用户主页 · 修改密码/简介 · Terminal（新 `admin` 命令直达图形台）
- **PWA 可安装** · 收藏系统 · 最近使用 · 亮暗主题 · 侧栏折叠 · System 账号封禁体系
- **温故知新 `/wgzx/`（v0.9.4 新增独立子站）**：初中 7~9 年级九学科复习平台（243 章节 / 1414 知识点 / 73 篇必背），闪卡 SRS / 出题练习 / 错题本 / 背诵打卡 / 学习统计 / AI 答疑（可选），进度存本机 localStorage；工作台侧栏新增「温故知新」入口

> v0.8.0 修复：进入工作台侧栏先显示邮箱再切用户名的闪烁（现在直接展示用户名）
>
> **v0.9.5 更新（《界面与布局优化方案》20 条执行项全量落地）：**
>
> - **尺度系统**：字号收敛 8 档（最小 12px）、间距 8 档（4px 网格）、圆角 5 档，新增 --fs-*/--sp-*/--r-* 令牌；断点统一 560/960/961；触控目标移动 44px / 桌面 32px
> - **色彩与图标**：图标色相 5 tone 收敛清零（gold 并入 amber、收藏页 8 色本地调色板并入 --ic 包络、办公页硬编码金修复，亮色对白底全部 ≥3:1）；密码强度条改 Teal 三阶；描边双层补完（亮色输入框边界 4.71:1）
> - **品牌统一**：/fuotool/ 主色回归 Teal（橙仅存「立即下载」CTA 与关键数据）、中文字体全站无衬线、favicon 恢复全站标准版
> - **主页 Hero 升级**：真实工作台截图替换抽象 mock + 关键数据统计带（17 工具 / 4 办公 / 9 学科 / 100% 本地）
> - **工作台信息架构**：新手引导改首次访问浮层；工具磁贴 16→8 高频 + 最近使用排序 + 「全部工具」入口；侧栏收藏计数徽标；统计「—/0」语义统一；面包屑全面汉化
> - **过渡与动效**：105 处 transition 收敛三档（120/180/260ms）+ 统一缓动；正文行长 68/72ch；drive 弹窗入场动画修复
> - **微交互打磨**：卡片微光统一 alpha 0.06；复制反馈统一 toast 1.6s；⌘/Ctrl+Enter 执行主操作（9 工具 + 平台感知提示）；收藏/笔记骨架屏；三处空态视觉统一
> - **资源版本矩阵**：style.css v9 / tool.css v7 / tool-page.js v8 / app.js v7 / sidebar.js v9 / SW fuo-shell-v10
>
> **v0.9.4 更新（温故知新接入 + 预览全站化 + 主题切换修复 + 布局 P0）：**
>
> - **`/wgzx/` 温故知新**：全新独立子站整体并入（红色独立设计语言，与主站互不影响）；侧栏「办公集」与「收藏」之间新增导航项，sitemap 已收录
> - **预览模式全站化**：`?preview=1` 一次进入即记忆（localStorage `fuo-preview`），工作台全部子页面免登录自由漫游（设置 / 收藏 / 回收站 / 办公集 / 管理台 / Terminal / 全部工具页 / wgzx），侧栏底部「退出预览」一键退出，`?preview=0` 显式清除
> - **亮暗切换三连修复**：切换后背景恒黑（View Transitions 层级显式声明 old=1/new=2 + skipTransition 三重兜底）；亮切暗闪白（双向统一「目标主题从点击处扩散」）；侧栏折叠/展开无动效（grid 轨道 0.3s 过渡 + padding 同步）；首帧画布按主题着色防加载白闪
> - **布局 P0**：消除工作台横向溢出（装饰层越界根因修复 + overflow-x 兜底）；≤560px 侧栏改离屏抽屉（汉堡按钮 + 遮罩 + Esc + 焦点管理）；工具页画布 780→1080 加宽居中、JSON/Base64/哈希/URL/Diff/UUID/密码 7 工具输出区统一（状态徽标 + 独立复制 + 状态行）；文字对比度全组达标复核
> - **资源版本全线 bump**：style.css v8 / theme.js v5 / sidebar.js v8 / config.js v6 / tool-page.js v7，SW 缓存 fuo-shell-v9——部署后强刷自动生效
>
> **v0.9.3 视觉升级（配色 v1.1「高级化升级」全站落地）：**
>
> - **光预算治理**：teal 光晕 28 处收拢到 4 处（Hero 极光 ×2 / 品牌标志微光 / 键盘焦点环，alpha 累计 7.54→1.39）；移除所有 hover 投影 / 装饰高光线 / 文字辉光 / 徽章辉光，hover 改用中性描边提亮 + 底色 ΔL≥3%，画面安静下来
> - **色预算治理**：图标色相 8→5 统一包络（cyan→teal · fuchsia→violet · orange→amber · emerald→green H142°；暗色 L72%/S60%、亮色 L32%/S62%），最小色相间距 13°→30°，不再「花」
> - **灰精度**：文字五档重建（--text/--text-2/--muted/--faint/--disabled），暗 faint 3.20→5.34:1 AA、亮 faint 3.00→5.04:1 AA，小字终于能读；面层明度阶梯重新分布（卡片 #0F1216 / hover #14191F / 弹层 #1A1F26）
> - **质感细节**：阴影换冷调墨色 rgba(2,8,12)；渐变文字三段彩虹→两端收敛；噪点 0.05→0.035；网格线改中性；焦点环提实（α 0.85）；选中底收住；**卡片上缘内高光**（inset 0 1px 0）让深色卡片有厚度
>
> **v0.9.1 修复与增强（依据《改进方案》17 项清单）：**
>
> - **P0 安全**：密码最低 8 位 + 实时强度条 + 密码≠用户名 + 连续失败 5 次锁 15 分钟；忘记密码闭环（邮件重置→自动进「设置新密码」模式）；服务条款与隐私政策页（注册强制勾选）；`_headers` 安全响应头
> - **P1 体验**：游客免登录试用 JSON / Base64（结果仅存本机，登录后同步）；登录后精准回跳原页面（`next` 参数贯通全站）；新用户工作台三步上手引导卡；主页/侧栏/页脚工具数全部统一为「17 款」
> - **P2 SEO**：OG/Twitter 分享卡（含 1200×630 封面图）；JSON-LD 结构化数据；sitemap.xml + robots.txt；主页关键词段落
> - **P3 打磨**：全站 35 个页面资源版本号统一 v=5；GitHub 链接修正为 Finokuo/Finokuo.github.io；注册弹窗邮箱 label 按模式切换
>
> **v0.9.0 新增：**
> - **`/fuotool/` 桌面版下载页**：暗色编辑排版设计（流体粒子背景 + 衬线大标题），含 AI 管理大师控制台自动演示、PC / iPhone / Android 设备扫描交互演示、下载卡与 FAQ；下载按钮预留 `DOWNLOAD_URL` 常量，exe 发布后填入直链即全局生效
> - **AI 管理大师网页端入口**：办公集金色引导卡 + 工作台办公集卡入口 + Ctrl+K 面板「Fuo Tool 桌面版」页面项，均指向 `/fuotool/`（完整功能在桌面版 exe 中提供）
>
> **v0.9.0 修复：**
> - 管理台 `System` 误判：原版把「档案查询出错」（如未执行 supabase-admin.sql 导致 status 列缺失）也当成「非 System」拒之门外；现拆成 查询出错 / 无档案行（回退注册名判定）/ 用户名不符（显示实际用户名）三分支，提示可自查
> - 点击头像直达个人展示页：工作台与全部子页面侧栏头像均可点击（含键盘 Enter/Space），跳转 `/drive/u/?u=<用户名>`

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
| `fuotool/index.html` | **v0.9 新增**：Fuo Tool 桌面版下载页（AI 管理大师引导，单文件自包含） |
| `wgzx/` | **v0.9.4 新增**：温故知新独立子站（初中全科复习，双击 index.html 亦可独立使用；`server.mjs` 为可选本地 AI 反代，部署到 GitHub Pages 无需运行） |
| `main/terms.html` + `main/privacy.html` | **v0.9.1 新增**：服务条款 / 隐私政策（注册强制勾选） |
| `_headers` / `robots.txt` / `sitemap.xml` | **v0.9.1 新增**：安全响应头 + SEO 爬虫规则 |
| `assets/og-cover.png` | **v0.9.1 新增**：社交分享封面图（1200×630） |
| `supabase-setup.sql` | 建表 + RLS 策略 + 触发器（全量，幂等可重复执行） |
| `supabase-notes.sql` | 云笔记增表（notes/folders/notes collections） |
| `supabase-admin.sql` | System 管理员增量（profiles.status + 触发器） |
| `supabase-v5.sql` | v0.7 增量：回收站软删除 / 公告表 / 操作日志 / 用户简介（幂等） |
| `supabase-v6.sql` | **v0.8 增量**：笔记置顶 / 公开分享 / 版本历史 / 办公集云同步（幂等） |
| `supabase-tester-password.sql` | **设置类**：Tester 统一密码——用户名含 tester 的账号按注册顺序重置为 123456T1 / 123456T2…（幂等可重跑，踢旧会话 + audit 留痕） |
| `supabase-v7.sql` | **v0.9.2 增量**：System 改密 RPC `admin_reset_password`（Terminal `passwd` 命令 + 管理台「改密」按钮共用；bcrypt 入库、强制下线、审计留痕、仅 authenticated 可调用） |
| `drive/manifest.json` + `drive/sw.js` | PWA：安装清单 + 离线缓存壳（仅 https 生效） |
| `drive/u/index.html` | 公开用户主页（`/u/?u=用户名`，未登录可看） |
