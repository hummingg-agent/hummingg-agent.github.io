# 纳指定投收益计算器（nasdaq-dca）

QQQ（纳指 100 ETF）定投收益计算器。React + TypeScript + Vite 静态站点，
月度行情数据通过 iFinD 拉取，由定时任务自动更新并部署到三个平台。

## 线上地址

| 平台 | 地址 | 说明 |
|------|------|------|
| Vercel（自有域名） | https://nasdaq.hummingg.com/ | 国内可访问，推荐对外分享 |
| GitHub Pages | https://hummingg-agent.github.io/ | 用户主页仓库 |
| Cloudflare Pages | https://hummingg.pages.dev/ | Git 集成自动构建 |
| Vercel（默认域名） | https://hummingg.vercel.app/ | vercel.app 在国内被屏蔽，海外可访问 |

四个地址服务同一份构建产物。

## 架构

```
每月 3 日 09:17（Asia/Shanghai）Kimi Work 定时任务
  → python scripts/update_data.py
      → iFinD 插件拉取 QQQ.O 月度前复权收盘价
      → 去重追加到 src/qqq_monthly.json（只保留已完结月份）
      → 有新数据 → git commit & push；无新数据 → 直接结束
  → push 触发三个平台云端自动构建部署：
      ├─ GitHub Actions → GitHub Pages
      ├─ Cloudflare Pages（Git 集成）
      └─ Vercel（Git 集成）
  → 任务会话记录结果 + 桌面通知
```

数据源 iFinD 插件只存在于本机 Kimi Work，因此「拉数」必须在本地运行，
「构建部署」全部在云端，本地唯一的写操作是 git push。

## 仓库说明

- 仓库：`github.com/hummingg-agent/hummingg-agent.github.io`（public，GitHub Pages 免费版要求）
- 本地目录名 `nasdaq-dca` 与仓库名无需一致
- 生产分支：`main`，push 即部署
- Git 提交身份：`aspk3424 <aspk3424@agent.qq.com>`

## 环境依赖

- Node.js 20+（当前 v24）
- npm 依赖：`npm install`（构建：`npm run build` → `dist/`）
- Kimi Work + iFinD 插件（数据拉取，脚本自动定位插件路径，macOS/Windows 均支持）
- `agent-gw` Python SDK（脚本首次运行时自动安装）
- gh CLI：登录 `hummingg-agent` 账号并执行过 `gh auth setup-git`（git push 凭证）
- 定时任务：Kimi Work Blueprint Automation `automation_f15059b0-89e6-49b8-a887-1276fdf1fee2`，
  cron `17 9 3 * *`（每月 3 日 09:17，Asia/Shanghai）

## 各平台配置

### GitHub Pages
- 仓库 Settings → Pages → Source: GitHub Actions
- 工作流：`.github/workflows/deploy.yml`（Node 24 + `npm ci` + `npm run build` → `dist`）

### Cloudflare Pages
- 项目名 `hummingg`（决定子域名 `hummingg.pages.dev`）
- Git 集成：GitHub App「Cloudflare Workers and Pages」授权本仓库
- 构建配置存在 Cloudflare 项目设置里：Build command `npm run build`，输出目录 `dist`
- **不要**在仓库里放 `wrangler.jsonc`（会干扰 Pages 构建解析，见故障记录 #7）

### Vercel
- 项目名 `hummingg`（原名 `nasdaq-dca`，改名后默认域名变为 `hummingg.vercel.app`）
- Git 集成需要两层授权（见故障记录 #8）
- 自定义域名 `nasdaq.hummingg.com` 绑定在 Vercel 项目

## 故障排查记录（2026-07-31 搭建实录）

1. **npm install 报 `Invalid Version:`** — 旧 `package-lock.json` 与当前 npm 版本不兼容（arborist bug）。
   解法：删除锁文件，`npm install --package-lock=false` 重装，再 `npm install --package-lock-only` 重新生成。
2. **npmmirror 源极慢** — registry.npmmirror.com 的 tarball 302 跳转目标不稳定。解法：用官方源 registry.npmjs.org。
3. **iFinD 插件找不到** — 原脚本只用 Windows `APPDATA` 定位插件。解法：`scripts/update_data.py` 的
   `find_ifind_tool()` 增加 macOS 路径 `~/Library/Application Support/kimi-desktop/...`。
4. **GitHub Pages 报 `No routes matched location "/nasdaq-dca/"`** — 项目页挂在子路径下，BrowserRouter 无法匹配。
   解法：改用 `HashRouter`（路由走 `#` 哈希，不依赖服务端路径，各平台通用）。
5. **GitHub 授权装错账号** — 机器上有 `hummingg` 和 `hummingg-agent` 两个 GitHub 账号，
   App 授权时务必确认浏览器会话是 `hummingg-agent`。
6. **Cloudflare API 建 Git 项目报 `8000011`（Git installation 损坏）** — 直接在 GitHub 侧装 App
   缺少 Cloudflare 一侧的登记。解法：必须从 Cloudflare Dashboard → Workers & Pages → Create →
   Pages → Connect to Git 发起，完成握手。
7. **Cloudflare 首次构建失败 × 2** — ① Build command 误填 `npx run build`（应为 `npm run build`）；
   ② 仓库里的 `wrangler.jsonc`（Workers 风格配置）被 Pages 误读。解法：API 修正构建命令 + 删除该文件。
8. **Vercel `git connect` 两层授权** — 先要在 https://vercel.com/account/login-connections 连接 GitHub
   身份，再在 https://github.com/apps/vercel/installations/new 把 Vercel App 装到 hummingg-agent
   并授权本仓库，两层都完成后 `vercel git connect` 才成功。
9. **vercel.app / api.vercel.com 国内不可达** — vercel.app 域名被屏蔽；API 偶发 SSL 中断。
   解法：验证 Vercel 部署用 `vercel ls hummingg`（不要用 curl 测 vercel.app）；API 调用用 curl
   `--retry 3 --retry-all-errors`；国内访问走自定义域名 `nasdaq.hummingg.com`。
10. **Vercel 改名后默认域名格式** — 新格式账号默认域名是 `<项目>-<scope>.vercel.app`，
    干净的 `hummingg.vercel.app` 需手动添加：`POST /v10/projects/{id}/domains`。

## 常用维护命令

```bash
# 手动执行一次数据更新（有新月线时自动 push 触发三平台部署）
python scripts/update_data.py

# 本地开发预览
npm run dev

# 检查三平台部署状态
gh run list --repo hummingg-agent/hummingg-agent.github.io --limit 1   # GitHub Actions
curl -s -o /dev/null -w '%{http_code}' https://hummingg.pages.dev/     # Cloudflare
node_modules/.bin/vercel ls hummingg                                   # Vercel（● Ready 即正常）
curl -s -o /dev/null -w '%{http_code}' https://nasdaq.hummingg.com/    # 自定义域名
```

## 换新机器重建环境

```bash
git clone https://github.com/hummingg-agent/hummingg-agent.github.io.git
cd hummingg-agent.github.io
npm install                       # 如遇 Invalid Version 见故障记录 #1
gh auth login                     # 登录 hummingg-agent，选 https 协议
gh auth setup-git
# 确认本机 Kimi Work 已装 iFinD 插件，然后验证：
python scripts/update_data.py
```

Vercel / Cloudflare 侧无需在本机登录——Git 集成后所有构建部署都在云端，
本机只需要 git push 权限和 iFinD 插件。
