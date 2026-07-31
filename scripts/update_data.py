#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQQ 月度行情自动更新 + 自动部署脚本

用法（在项目根目录执行）：
    python scripts/update_data.py

流程：
  1. 读取 src/qqq_monthly.json 最后一个日期
  2. 通过 iFinD 插件拉取该日期前 45 天 ~ 今天的 QQQ.O 月度前复权行情
  3. 只保留「已完结月份」的数据（过滤当月未完结的 K 线），去重后追加合并
  4. 有新数据 → git commit & push → 两个平台云端自动构建部署：
       - GitHub Actions → GitHub Pages（https://hummingg-agent.github.io/）
       - Cloudflare Workers Builds → workers.dev（Git 集成，见 wrangler.jsonc）
     没有新数据 → 直接结束，不部署

依赖：
  - 本机 Kimi Work 已安装 iFinD 插件（脚本会自动定位）
  - 本机 gh CLI 已登录 hummingg-agent 并配置 git 凭证（gh auth setup-git）
"""
import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "src" / "qqq_monthly.json"
TMP_DIR = ROOT / "tmp"
TICKER = "QQQ.O"

ENV = {**os.environ, "VERCEL_TELEMETRY_DISABLED": "1"}


def log(msg: str) -> None:
    print(f"[update_data] {msg}", flush=True)


def find_ifind_tool() -> Path:
    """在各机器的 Kimi Work 插件目录中定位 ifind_tool.py"""
    candidates = [
        Path(os.environ.get("APPDATA", ""))
        / "kimi-desktop/daimon-share/daimon/runtime/kimi-code/home/plugins/managed/ifind/scripts/ifind_tool.py",
        Path.home()
        / "Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/kimi-code/home/plugins/managed/ifind/scripts/ifind_tool.py",
    ]
    for p in candidates:
        if p.exists():
            return p
    raise SystemExit(f"未找到 iFinD 插件脚本，尝试过：{[str(p) for p in candidates]}")


def ensure_agent_gw() -> None:
    try:
        import agent_gw  # noqa: F401
    except ImportError:
        log("安装 agent-gw SDK ...")
        url = subprocess.check_output(
            [sys.executable, "-c",
             "import json,urllib.request;print(json.load(urllib.request.urlopen('https://cdn.kimi.com/agentgw/pysdk/manifest.json'))['latest']['url'])"]
        ).decode().strip()
        subprocess.check_call([sys.executable, "-m", "pip", "install", url])


def fetch_prices(start: date, end: date) -> list[dict]:
    ifind = find_ifind_tool()
    ensure_agent_gw()
    TMP_DIR.mkdir(exist_ok=True)
    csv_path = TMP_DIR / "ifind_latest.csv"
    params = {
        "ticker": TICKER,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "interval": "M",
        "adjust": "forward",
        "file_path": str(csv_path).replace("\\", "/"),
    }
    r = subprocess.run(
        [sys.executable, str(ifind), "call", "--api-name", "ifind_get_price",
         "--params-json", json.dumps(params)],
        capture_output=True, text=True, env=ENV,
    )
    if r.returncode != 0 or not csv_path.exists():
        raise SystemExit(f"iFinD 拉取失败：{r.stdout[-500:]} {r.stderr[-500:]}")
    rows = []
    current_ym = date.today().strftime("%Y-%m")
    for i, line in enumerate(csv_path.read_text(encoding="utf-8").splitlines()):
        if i == 0 or not line.strip():
            continue
        cols = dict(zip("open,high,low,close,volume,thscode,time,thsname_cn,thsname_en,currency".split(","),
                        line.split(",")))
        d = cols["time"][:10]
        if d[:7] == current_ym:
            continue  # 当月 K 线未完结，丢弃
        rows.append({"d": d, "c": round(float(cols["close"]), 4)})
    log(f"iFinD 返回 {len(rows)} 条已完结月度数据（{start} ~ {end}）")
    return rows


def run_git(*args: str) -> None:
    subprocess.check_call(["git", *args], cwd=ROOT, env=ENV)


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    last = datetime.strptime(data[-1]["d"], "%Y-%m-%d").date()
    log(f"现有数据 {len(data)} 条，最新日期 {last}")

    new_rows = fetch_prices(last - timedelta(days=45), date.today())
    existing = {r["d"] for r in data}
    added = [r for r in new_rows if r["d"] not in existing]

    if not added:
        log("没有新数据，本次不部署。结束。")
        return

    merged = sorted(data + added, key=lambda r: r["d"])
    DATA_FILE.write_text(json.dumps(merged, separators=(",", ":")), encoding="utf-8")
    log(f"新增 {len(added)} 个月度数据：{[r['d'] for r in added]}，总计 {len(merged)} 条")

    log("提交新数据并推送到 GitHub ...")
    run_git("add", "src/qqq_monthly.json")
    run_git("commit", "-m",
            f"data: add {len(added)} monthly bar(s) ({added[0]['d']} ~ {added[-1]['d']})")
    run_git("push")
    log("已推送。GitHub Actions 部署到 GitHub Pages，Cloudflare Workers Builds 同步自动构建部署。")


if __name__ == "__main__":
    main()
