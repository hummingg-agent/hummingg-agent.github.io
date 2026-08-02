#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多标的月度行情自动更新 + 自动部署脚本

用法（在项目根目录执行）：
    python scripts/update_data.py

流程：
  1. 快检东方财富 push2his 是否可达（决定 SPX 能否拉全量 1990 历史）
  2. 运行 global_index_collector 的 main.py update（免费源：新浪 / 东方财富 / AkShare，
     带限速防封）刷新 SQLite
  3. 运行 export_dca.py 从 SQLite 重新导出 src/data/<key>.json（月线）+ <key>_daily.json（日线）
  4. 若 src/data 有变更 -> git commit & push -> 各平台云端自动构建部署：
       - GitHub Actions → GitHub Pages
       - Cloudflare Workers Builds / Pages（Git 集成）
       - Vercel（Git 集成）
       - EdgeOne（Git 集成）
     没有新数据 → 直接结束，不部署

数据源：免费源（原 iFinD / Wind 付费源已移除）。详见 global_index_collector。

健壮性：
  - 东财不可达时明确告警（SPX 将退化为新浪 ~1000 交易日 ≈4 年历史）。
  - git push 走本机代理（ClashX 127.0.0.1:7892）若失败（代理未启动），
    自动降级为绕过代理直连重试，避免"提交成功但推送卡死"的半吊子状态。
  - 启动时检测本地是否有未推送提交，自动补推（上次的失败推送不会永久卡住）。

依赖：
  - 本机已安装 global_index_collector 环境（含 akshare 的 python，见 COLLECTOR_PY）
  - 本机 gh CLI 已登录 hummingg-agent 并配置 git 凭证（gh auth setup-git）
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COLLECTOR_DIR = Path("/Users/hummingg/WorkBuddy/2026-08-01-18-22-16/global_index_collector")
COLLECTOR_PY = Path("/Users/hummingg/.workbuddy/binaries/python/envs/default/bin/python")
DCA_DATA = ROOT / "src" / "data"

ENV = {**os.environ, "VERCEL_TELEMETRY_DISABLED": "1"}
# ClashX 默认代理端口；本机 git 走代理时若它没启动，push 会 'Couldn't connect to server'
PROXY_PORT_HINT = "7892"

ASSETS = {
    "qqq":   {"name": "纳斯达克100 ETF"},
    "spx":   {"name": "标普500"},
    "hs300": {"name": "沪深300"},
    "zz500": {"name": "中证500"},
    "hsi":   {"name": "恒生指数"},
}


def log(msg: str) -> None:
    print(f"[update_data] {msg}", flush=True)


def run_git(*args: str) -> None:
    subprocess.check_call(["git", *args], cwd=str(ROOT), env=ENV)


def run(cmd: list) -> int:
    log("执行: " + " ".join(str(c) for c in cmd))
    return subprocess.run([str(c) for c in cmd], cwd=str(ROOT), env=ENV).returncode


def _probe_eastmoney() -> bool:
    """快检东方财富 push2his 是否可达（决定 SPX 能否拉全量 1990 历史）。仅用标准库。"""
    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get"
           "?secid=100.SPX&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=0"
           "&beg=20250101&end=20250110")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0",
                 "Referer": "https://quote.eastmoney.com/"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8", "ignore"))
            k = data.get("data", {}) or {}
            return bool(k.get("klines"))
    except Exception:
        return False


def _check_spx_range() -> None:
    """导出后检查 SPX 数据起点：若被截断到 2004（仅新浪），明确告警。"""
    spx = DCA_DATA / "spx.json"
    if not spx.exists():
        return
    try:
        data = json.loads(spx.read_text(encoding="utf-8"))
        if data:
            first = data[0].get("d", "")
            year = int(first[:4])
            if year > 2003:
                log(f"⚠️ SPX 数据起点为 {first}（仅新浪 ~1000 交易日历史）。")
                log(f"   东方财富不可达时无法拉全量（1990 起）。"
                    f"若需完整历史，请在可直连东财的环境重跑本脚本。")
            else:
                log(f"SPX 数据起点 {first}（已含全量历史）。")
    except Exception:
        pass


def _local_ahead() -> bool:
    """本地分支是否领先远端（有未推送提交）。"""
    r = subprocess.run(["git", "rev-list", "--count", "origin/main..HEAD"],
                       cwd=str(ROOT), env=ENV, capture_output=True, text=True)
    if r.returncode != 0:
        return False
    try:
        return int(r.stdout.strip() or "0") > 0
    except ValueError:
        return False


def _is_proxy_error(text: str) -> bool:
    t = (text or "").lower()
    return (PROXY_PORT_HINT in t
            or "couldn't connect to server" in t
            or "failed to connect" in t
            or "connection refused" in t
            or "connection reset" in t)


def _git_push_once(proxy_override: bool = False) -> subprocess.CompletedProcess:
    args = ["git"]
    if proxy_override:
        # 绕过本机代理直连（清空 git 配置的 http(s).proxy）
        args += ["-c", "http.proxy=", "-c", "https.proxy="]
    args.append("push")
    env = {**ENV}
    if proxy_override:
        # 同时清掉环境变量里的代理，双保险
        for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            env.pop(k, None)
    return subprocess.run(args, cwd=str(ROOT), env=env,
                          capture_output=True, text=True)


def git_push() -> bool:
    """push 带重试；遇到代理故障自动降级为绕过代理直连重试。

    常见故障：本机 ClashX(127.0.0.1:7892) 未启动，git 走代理配置时
    'Couldn't connect to server'。此时若本机可直连 github，绕过代理即可成功。
    """
    last_err = ""

    # 阶段1：常规 push（尊重现有代理配置），最多 3 次
    for attempt in range(3):
        r = _git_push_once(proxy_override=False)
        if r.returncode == 0:
            return True
        last_err = (r.stderr or r.stdout or "")[:200]
        if _is_proxy_error(last_err):
            log(f"  git push 第 {attempt + 1} 次失败（疑似本地代理未启动）："
                f"{last_err[-150:]}")
            break  # 进入代理绕过阶段
        log(f"  git push 第 {attempt + 1} 次失败，15 秒后重试：{last_err[-150:]}")
        time.sleep(15)
    else:
        # 3 次常规均失败且非代理问题 -> 直接判失败
        return False

    # 阶段2：绕过代理直连重试（最多 2 次）
    log("  代理疑似不可用，尝试绕过本地代理直连推送（env -u + -c http.proxy=）...")
    for attempt in range(2):
        r = _git_push_once(proxy_override=True)
        if r.returncode == 0:
            log("  绕过代理直连推送成功。")
            return True
        last_err = (r.stderr or r.stdout or "")[:200]
        log(f"  绕过代理重试 {attempt + 1} 失败：{last_err[-150:]}")
        time.sleep(10)
    return False


def main() -> None:
    log("=== 月度更新（免费源）===")

    # 0) 补推上次可能卡住的本地提交（避免半吊子状态永久滞留）
    if _local_ahead():
        log("检测到本地有未推送的提交，先尝试补推...")
        if git_push():
            log("补推成功。")
        else:
            log("⚠️ 补推仍失败，提交保留在本地，继续本次更新后再次尝试。")

    # 1) 快检东财可达性（决定 SPX 能否拉全量）
    if _probe_eastmoney():
        log("东方财富 push2his 可达：SPX 将拉取全量历史（1990 起）。")
    else:
        log("⚠️ 东方财富 push2his 不可达：SPX 将退化为新浪 ~1000 交易日（≈4 年）历史。"
            "如需要完整历史，请在可直连东财的环境运行。")

    # 2) 刷新 collector（免费源；增量幂等，东财在沙箱会被熔断降级，真机拉全量）
    if COLLECTOR_PY.exists():
        rc = run([COLLECTOR_PY, COLLECTOR_DIR / "main.py", "update"])
        if rc != 0:
            log("⚠️ collector update 返回非零，将使用现有 SQLite 继续导出")
    else:
        log(f"未找到 collector python：{COLLECTOR_PY}，跳过刷新（使用现有 SQLite）")

    # 3) 导出到 src/data
    if COLLECTOR_PY.exists():
        rc = run([COLLECTOR_PY, COLLECTOR_DIR / "export_dca.py",
                  COLLECTOR_DIR / "global_index.db", DCA_DATA])
    else:
        rc = run([sys.executable, COLLECTOR_DIR / "export_dca.py",
                  COLLECTOR_DIR / "global_index.db", DCA_DATA])
    if rc != 0:
        log("⚠️ 导出失败，终止")
        return

    # 3.1) 导出后检查 SPX 历史是否被截断
    _check_spx_range()

    # 4) 检测变更并提交推送
    st = subprocess.run(["git", "status", "--porcelain", "src/data"],
                        cwd=str(ROOT), env=ENV, capture_output=True, text=True)
    if not st.stdout.strip():
        log("src/data 无变更，本次不部署。结束。")
        return
    changed = [line.split()[-1] for line in st.stdout.strip().splitlines()]
    log(f"检测到变更文件：{changed}")
    run_git("add", "src/data")
    run_git("commit", "-m", f"data: update (free sources) {len(changed)} files")
    if git_push():
        log("已推送。GitHub Pages / Cloudflare / Vercel / EdgeOne 将自动构建部署。")
    else:
        log("⚠️ git push 多次失败：提交保留在本地。")
        log("   若提示代理未启动，可手动直连推送：")
        log("   cd " + str(ROOT))
        log("   env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy "
            "git -c http.proxy= -c https.proxy= push origin main")
        log("   或先启动 ClashX 后直接：git push origin main")


if __name__ == "__main__":
    main()
