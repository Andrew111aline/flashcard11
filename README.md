# FSRS Flashcards Web

一个面向网站部署的笔记优先闪卡项目，内置 FSRS 复习调度、Cloze/双向卡、卡片质量检查、提醒和多格式导出。

## 本地开发

前置要求：Node.js 20+

```bash
npm install
npm run dev
```

默认会在 `http://localhost:3000` 启动。

## 网站打包

项目已经适配为可直接静态部署的网站包：

```bash
npm run package:web
```

产物会输出到 `dist/`。

如果你准备把站点部署到子路径，例如 `https://example.com/flashcards/`，可以在打包前设置 `VITE_BASE_URL`：

```bash
VITE_BASE_URL=/flashcards/ npm run build
```

Windows PowerShell 示例：

```powershell
$env:VITE_BASE_URL='/flashcards/'
npm run build
```

如果需要生成一个可双击运行的 Windows 启动包：

```bash
npm run package:bat
```

它会生成：

- `release/site/`：网站静态文件
- `release/open-site.bat`：双击后自动启动本地站点并打开浏览器
- `release/serve-site.ps1`：BAT 调用的本地静态服务脚本

## 部署建议

- Nginx / 静态托管：直接发布 `dist/`
- GitHub Pages / 子目录部署：设置 `VITE_BASE_URL`
- PWA：已启用 manifest 与 service worker，适合移动端安装

## 导出与兼容

设置页现在提供以下导出方向：

- 完整备份 JSON，可直接在站点内重新导入
- Open Study Pack JSON，适合开源迁移与二次开发
- 通用 CSV，适合墨墨记忆卡等需要二次整理导入的产品
- Anki 文本导出（Basic / Reversed / Cloze 分文件）

## 制卡建议

- 一卡一知识点，避免把多个问题塞到同一张卡里
- 优先使用带语境的提示和 Cloze，而不是孤立硬背
- 把解释、来源、例句放进 Extra，而不是把答案写得过长
- 尚未理解透的内容先记成 Note，再逐步拆成卡片
