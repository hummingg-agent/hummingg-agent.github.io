# 指数基金定投收益计算器（nasdaq-dca）

多标的指数基金定投收益计算器。React + TypeScript + Vite 静态站点，
月度行情数据通过 iFinD / Wind 插件拉取，由定时任务自动更新并部署到四个平台。

## 标的与数据源

| 标的 | 代码 | 币种 | 数据源 | 数据起点 |
|------|------|------|--------|----------|
| 纳斯达克100 ETF | QQQ.O | USD | iFinD | 1999-03 |
| 标普500指数 | SPX.GI | USD | Wind index_data | 1990-01 |
| 沪深300指数 | 000300.SH | CNY | iFinD | 2002-01 |
| 中证500指数 | 000905.SH | CNY | iFinD | 2004-12 |
| 恒生指数 | HSI.HI | HKD | Wind index_data | 1990-01 |

数据文件：`src/data/<key>.json`，格式 `[{"d":"YYYY-MM-DD","c":close}]`（前复权月收盘价）。
前端按标的切换，支持自定义每月定投金额（USD / CNY / HKD 自动格式化）。

注意：SPY / VOO / DIA 等美股 ETF（除 QQQ.O 外）在 iFinD 与 Wind 插件均取不到
长期月线（Wind fund 通道仅有 2018 年后数据），故美股标普500敞口用 SPX.GI 指数代替。
两家数据源价格复权口径不同（如 1999-03 QQQ：iFinD 44.27 vs Wind 88.54），
同一标的的数据必须始终来自同一数据源，不可混用。

## 线上地址

| 平台 | 地址 | 说明 |
|------|------|------|
| **主域名（Cloudflare Pages）** | https://dingtouji.com/ （含 www） | 品牌域名，Cloudflare Registrar 注册，SEO canonical |
| Vercel（自有域名） | https://nasdaq.hummingg.com/ | 国内可访问 |
| EdgeOne（自有域名） | https://edgeone.hummingg.com/ | 腾讯边缘节点，国内最快 |
| GitHub Pages | https://hummingg-agent.github.io/ | 用户主页仓库 |
| Cloudflare Pages | https://hummingg.pages.dev/ | Git 集成自动构建 |
| Vercel（默认域名） | https://hummingg.vercel.app/ | vercel.app 在国内被屏蔽，海外可访问 |

主域名绑定：Cloudflare DNS 手动 CNAME `dingtouji.com` / `www` → `hummingg.pages.dev`
（橙云代理，根域名 CNAME 拉平）。Pages 项目域名管理里的验证状态可能长时间显示
pending，不影响实际访问（代理 CNAME 直接生效，证书由 Cloudflare 边缘自动签发）。
wrangler OAuth token 无 zone DNS 写权限，DNS 记录改用 Cloudflare MCP 插件创建。

五个地址服务同一份构建产物。

### 域名访问实测（2026-07-31 22:40，国内直连）

| 域名 | 结果 | 说明 |
|------|------|------|
| https://dingtouji.com/ 与 https://www.dingtouji.com/ | ✅ 200 | 主域名，国内直连稳定，内容已是最新构建 |
| https://edgeone.hummingg.com/ | ✅ 200 | EdgeOne 自定义域名，国内直连稳定 |
| https://nasdaq.hummingg.com/ | ✅ 200 | Vercel 自有域名，国内可访问 |
| https://hummingg-agent.github.io/ | ✅ 200 | GitHub Pages，内容已是最新构建 |
| https://hummingg.pages.dev/ | ✅ 200 | Cloudflare Pages 默认域名 |
| https://hummingg.vercel.app/ | ❌ 直连超时 | vercel.app 在国内被屏蔽，挂代理可访问 |
| https://hummingg.edgeone.dev/ | ❌ 401 | 预期行为：EdgeOne 默认域名在大陆一律 401（平台合规规则），须用自定义域名 |
| https://nasdaq-dca.pages.dev/ | ❌ 直连超时 | 项目改名前的旧默认域名，以 hummingg.pages.dev 为准 |

日常分享推荐：dingtouji.com 或 edgeone.hummingg.com（国内直连最稳）。

## 架构

```
每月 3 日 09:17（Asia/Shanghai）Kimi Work 定时任务
  → python scripts/update_data.py
      → 遍历 5 个标的，按数据源增量拉取月度前复权收盘价
        （iFinD：QQQ.O / 000300.SH / 000905.SH；Wind：SPX.GI / HSI.HI）
      → 去重追加到 src/data/<key>.json（只保留已完结月份）
      → 有新数据 → git commit & push；无新数据 → 直接结束
  → push 触发四个平台云端自动构建部署：
      ├─ GitHub Actions → GitHub Pages
      ├─ Cloudflare Pages（Git 集成）
      ├─ Vercel（Git 集成）
      └─ 腾讯 EdgeOne Pages（Git 集成）
  → 任务会话记录结果 + 桌面通知
```

数据源插件只存在于本机 Kimi Work，因此「拉数」必须在本地运行，
「构建部署」全部在云端，本地唯一的写操作是 git push。

## 脚本

- `scripts/update_data.py`：月度增量更新（定时任务调用）
- `scripts/fetch_history.py`：全量历史回灌，用法 `python3 scripts/fetch_history.py [key ...]`
  （不传 key 则全部重建；iFinD 单次限 3 年、Wind 单次约百条，脚本自动分块）

## 仓库说明

- 仓库：`github.com/hummingg-agent/hummingg-agent.github.io`（public，GitHub Pages 免费版要求）
- 本地目录名 `nasdaq-dca` 与仓库名无需一致
- 生产分支：`main`，push 即部署
- Git 提交身份：`aspk3424 <aspk3424@agent.qq.com>`

## 环境依赖

- Node.js 20+（当前 v24）
- npm 依赖：`npm install`（构建：`npm run build` → `dist/`）
- Kimi Work + iFinD 与 Wind 插件（数据拉取，脚本自动定位插件路径，macOS/Windows 均支持）
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

### 腾讯 EdgeOne Pages（国际版 edgeone.ai）
- 项目名 `hummingg`，Git 集成：GitHub App 授权本仓库，构建 `npm run build` / 输出 `dist`
- 加速区域「全球（不含中国大陆）」：默认域名 `*.edgeone.dev` 在大陆访问一律 401（平台合规规则），
  必须绑定自定义域名（无需 ICP 备案）才能在国内稳定访问
- 自定义域名 `edgeone.hummingg.com`：TXT 所有权验证（`edgeonereclaim.edgeone` 主机记录）
  + 精确 CNAME 到 `edgeone.hummingg.com.pages.dnsoe7.com`
- **HTTPS 证书需在控制台手动申请**：域名管理 → 域名 → HTTPS 配置 → 边缘 HTTPS 证书 → 配置 → 免费证书

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
11. **EdgeOne 默认域名大陆 401** — 「全球（不含中国大陆）」加速区域下，`*.edgeone.dev` 默认域名
    在大陆网络一律返回 401（`X-EOP-MSG: eo_time missing`），属平台合规规则而非故障。
    解法：绑定自定义域名（无需备案）。
12. **自定义域名被泛解析劫持** — DNS 中 `*.hummingg.com → vercel-dns` 的泛解析会接管所有子域名。
    解法：精确记录优先于通配符，为 `edgeone` 主机加一条精确 CNAME 即可，不影响其他子域名。
13. **EdgeOne 自定义域名 HTTPS 不自动签发** — 域名「已生效」后证书仍是「未配置」（回退到
    `*.cdn.myqcloud.com` 通用证书，浏览器报不安全）。解法：域名管理 → HTTPS 配置 → 手动点「配置」
    申请免费证书，几分钟后专用证书就绪。

## 常用维护命令

```bash
# 手动执行一次数据更新（有新月线时自动 push 触发四平台部署）
python scripts/update_data.py

# 本地开发预览
npm run dev

# 检查四平台部署状态
gh run list --repo hummingg-agent/hummingg-agent.github.io --limit 1   # GitHub Actions
curl -s -o /dev/null -w '%{http_code}' https://hummingg.pages.dev/     # Cloudflare
node_modules/.bin/vercel ls hummingg                                   # Vercel（● Ready 即正常）
curl -s -o /dev/null -w '%{http_code}' https://nasdaq.hummingg.com/    # Vercel 自定义域名
curl -s -o /dev/null -w '%{http_code}' https://edgeone.hummingg.com/   # EdgeOne
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

Vercel / Cloudflare / EdgeOne 侧无需在本机登录——Git 集成后所有构建部署都在云端，
本机只需要 git push 权限和 iFinD 插件。
