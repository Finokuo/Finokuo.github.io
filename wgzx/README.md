# 温故知新 · 初中全科复习(纯静态版)

> 「温故而知新, 可以为师矣。」——《论语》

初中 7~9 年级九大学科复习平台: 语文、数学、英语、物理、化学、生物、历史、地理、道德与法治。
**纯静态 HTML/CSS/JS 实现, 不依赖 Bun/Node/数据库 —— 解压后双击 index.html 即可使用。**

## 内容规模

- 9 个学科 / 243 个章节 / 1414 个知识点(课内 1002 · 拓展 412)
- 必背古诗文 + 道法观点背诵篇目 73 篇
- 九套主流教材版本目录(人教/北师大/统编…), 章节直达复习内容

## 快速开始

1. **直接使用**: 双击 `index.html`(Chrome / Edge / Safari / Firefox 均可)。
2. 学习进度、错题本、背诵打卡自动保存在**本机浏览器**(localStorage), 无需注册登录。
3. 若浏览器提示数据只读或页面空白: 请不要放在需管理员权限的目录(如 C:\Program Files), 解压到普通文件夹即可。

## 并入 FuoTool(子目录集成)

顶栏「返回 FuoTool」按钮已写入固定地址 `https://finokuo.github.io/`(FuoTool 主页)。
若日后地址变更, 修改 `js/header.js` 顶部的 `FUOTOOL_URL` 即可(知识库整合页 `knowledge-base.html` 顶栏同样带返回链接)。

## 功能一览

| 功能 | 离线可用 | 说明 |
| --- | --- | --- |
| 学科/章节/知识点浏览 | 是 | 全部内容本地内置 |
| 全文搜索 | 是 | 标题/内容/标签, 关键词高亮 |
| 闪卡复习(SRS 间隔重复) | 是 | Leitner 五盒模型, 到期自动排程 |
| 出题练习 | 部分 | 无 AI 时由本机题库生成(取自知识点例题/要点) |
| 智能组卷打印 | 部分 | 同上; 打印自动隐藏按钮与答案区 |
| 错题本 | 是 | 自动收录错题, 重复错误累计次数 |
| 背诵打卡 | 是 | 73 篇目, 打卡/状态推进/挖空自测 |
| 朗读 | 是 | 浏览器内置语音合成(speechSynthesis) |
| 学习统计 | 是 | 热力图/掌握度/连续天数/时长 |
| AI 答疑/费曼评估/AI 找错 | 需配置 | 见下方「AI 服务」 |

## AI 服务(可选)

AI 答疑、费曼讲解评估、错题诊断、AI 出题需要一个 OpenAI 兼容接口。三种方式任选:

**方式 A: 自带 AI 的托管环境**
把本目录上传到提供 `/api/ai/*` 后端的主机(站点会自动探测), AI 功能即刻可用。

**方式 B: 页面内配置你自己的 AI**
1. 打开页面 → 右下角 AI 助手 → 右上角齿轮(AI 服务设置);
2. 选「自定义 AI 服务」, 填入 API 地址、模型名、API Key(支持 OpenAI / DeepSeek / 智谱 / Moonshot 等);
3. 配置仅保存在本机浏览器, 不会上传。
若服务方不允许浏览器直接跨域调用(CORS), 请改用方式 C。

**方式 C: 一行命令启动本地服务(推荐, Node ≥ 18)**
```bash
node server.mjs
```
默认接入内置 GLM4 AI 服务(开箱即用): 上游地址**内网优先、公网回退**——先试内网网关地址, 不通自动改试公网地址, 任一可用即沿用; 然后浏览器打开 http://localhost:8080。
如需换成自己的 AI(OpenAI / DeepSeek / 智谱等), 用环境变量覆盖:
```bash
AI_BASE_URL=https://api.deepseek.com/v1 AI_API_KEY=sk-你的key AI_MODEL=deepseek-chat node server.mjs
```

## 数据与隐私

- 全部学习数据只存本机浏览器 localStorage(键名 `wengu-progress-v1`), 不上传任何服务器。
- 想清空进度: 浏览器开发者工具 → Application → Local Storage → 删除该键。
- 与旧版(Bun/Next.js 版)共用同一存储键, 学习进度可互相延续。

## 目录结构

```text
wgzx-static-site/
├── index.html        入口(唯一 HTML)
├── css/style.css     设计系统与全部样式
├── js/               应用脚本(经典 script, 无构建)
│   ├── core.js       命名空间/DOM 工具/图标/弹窗
│   ├── store.js      学习进度状态(localStorage 持久化)
│   ├── data.js       知识库索引与检索
│   ├── ui.js         共享组件
│   ├── ai.js         AI 能力层 + 小知聊天面板
│   ├── header.js / footer.js
│   ├── app.js        Hash 路由与启动
│   └── views/        13 个视图(home/browse/study 三组)
├── data/             九学科知识库 + 教材目录 + 背诵篇目(纯 JS 数据)
├── server.mjs        可选: 零依赖 Node 服务器(静态 + AI 反代)
└── README.md         本文件
```

## 内容如何更新

数据源仍是 `wgzx-website`(Bun 版)项目的 `src/data/subjects/*.ts`: 编辑后运行
`bun run scripts/gen-static-data.ts` 重新导出 `data/*.js`, 再重新打包即可。

- 打包时间: 2026年11月18日 18:27(Asia/Shanghai)
- 纯静态版由 scripts/gen-static-zip.ts 自动打包, 请勿手改包内文件。
