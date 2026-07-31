#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多标的月度行情自动更新 + 自动部署脚本

用法（在项目根目录执行）：
    python scripts/update_data.py

流程：
  1. 遍历资产注册表（src/data/<key>.json），读取各自最后一个日期
  2. 按数据源增量拉取该日期前 45 天 ~ 今天的月度前复权行情：
       - iFinD（ifind_get_price，单次 ≤3 年）：QQQ.O / 000300.SH / 000905.SH
       - Wind index_data（get_index_kline，月 K）：SPX.GI / HSI.HI
  3. 只保留「已完结月份」的数据（过滤当月未完结的 K 线），去重后追加合并
  4. 任一标的有新数据 → git commit & push → 各平台云端自动构建部署：
       - GitHub Actions → GitHub Pages
       - Cloudflare Workers Builds / Pages（Git 集成）
       - Vercel（Git 集成）
       - EdgeOne（Git 集成）
     没有新数据 → 直接结束，不部署

历史数据重建（全量回灌）用 scripts/fetch_history.py。

依赖：
  - 本机 Kimi Work 已安装 iFinD 与 Wind 插件（脚本会自动定位）
  - 本机 gh CLI 已登录 hummingg-agent 并配置 git 凭证（gh auth setup-git）
"""
import csv
import io
import json
import os
import re
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
TMP_DIR = ROOT / "tmp"

IFIND_TOOL = Path.home() / (
    "Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/"
    "kimi-code/home/plugins/managed/ifind/scripts/ifind_tool.py"
)
IFIND_TOOL_WIN = Path(os.environ.get("APPDATA", "")) / (
    "kimi-desktop/daimon-share/daimon/runtime/kimi-code/home/plugins/managed/ifind/scripts/ifind_tool.py"
)
WIND_CLI = Path.home() / (
    "Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/"
    "kimi-code/home/plugins/managed/wind-allskill/skills/wind-mcp-skill/scripts/cli.mjs"
)

ASSETS = {
    "qqq": {"source": "ifind", "code": "QQQ.O"},
    "spx": {"source": "wind_index", "code": "SPX.GI"},
    "hs300": {"source": "ifind", "code": "000300.SH"},
    "zz500": {"source": "ifind", "code": "000905.SH"},
    "hsi": {"source": "wind_index", "code": "HSI.HI"},
}

ENV = {**os.environ, "VERCEL_TELEMETRY_DISABLED": "1"}


def log(msg: str) -> None:
    print(f"[update_data] {msg}", flush=True)


def find_ifind_tool() -> Path:
    for p in (IFIND_TOOL, IFIND_TOOL_WIN):
        if p.exists():
            return p
    raise SystemExit(f"未找到 iFinD 插件脚本，尝试过：{[str(p) for p in (IFIND_TOOL, IFIND_TOOL_WIN)]}")


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


def fetch_ifind(code: str, start: date, end: date) -> list[dict]:
    ifind = find_ifind_tool()
    ensure_agent_gw()
    TMP_DIR.mkdir(exist_ok=True)
    csv_path = TMP_DIR / f"ifind_{code.replace('.', '_')}.csv"
    if csv_path.exists():
        csv_path.unlink()
    params = {
        "ticker": code,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "interval": "M",
        "adjust": "forward",
        "file_path": str(csv_path).replace("\\", "/"),
    }
    for attempt in range(3):
        r = subprocess.run(
            [sys.executable, str(ifind), "call", "--api-name", "ifind_get_price",
             "--params-json", json.dumps(params)],
            capture_output=True, text=True, env=ENV, timeout=300,
        )
        if r.returncode == 0 and csv_path.exists():
            break
        log(f"  iFinD {code} 第 {attempt + 1} 次失败，重试")
    else:
        raise SystemExit(f"iFinD 拉取 {code} 失败：{r.stdout[-500:]} {r.stderr[-500:]}")
    rows = []
    lines = csv_path.read_text(encoding="utf-8").splitlines()
    header = lines[0].split(",")
    for line in lines[1:]:
        if not line.strip():
            continue
        cols = dict(zip(header, line.split(",")))
        if not cols.get("time") or not cols.get("close"):
            continue
        rows.append({"d": cols["time"][:10], "c": round(float(cols["close"]), 4)})
    log(f"  iFinD {code} 返回 {len(rows)} 条月度数据（{start} ~ {end}）")
    return rows


def fetch_wind_index(code: str, start: date, end: date) -> list[dict]:
    params = {
        "windcode": code,
        "begin_date": start.strftime("%Y%m%d"),
        "end_date": end.strftime("%Y%m%d"),
        "period": "12",
    }
    csv_path = None
    out = ""
    for attempt in range(3):
        r = subprocess.run(
            ["node", str(WIND_CLI), "call", "index_data", "get_index_kline", json.dumps(params)],
            capture_output=True, text=True, timeout=600,
        )
        out = r.stdout + r.stderr
        m = re.search(r"saved to (/\S+?\.csv)", out)
        if m and Path(m.group(1)).exists():
            csv_path = Path(m.group(1))
            break
        log(f"  Wind {code} 第 {attempt + 1} 次失败，重试")
    if csv_path is None:
        raise SystemExit(f"Wind 拉取 {code} 失败：{out[-600:]}")
    rows = []
    reader = csv.DictReader(io.StringIO(csv_path.read_text(encoding="utf-8")))
    for rec in reader:
        if not rec.get("trade_date") or not rec.get("close"):
            continue
        rows.append({"d": rec["trade_date"][:10], "c": round(float(rec["close"]), 4)})
    log(f"  Wind {code} 返回 {len(rows)} 条月度数据（{start} ~ {end}）")
    return rows


def run_git(*args: str) -> None:
    subprocess.check_call(["git", *args], cwd=ROOT, env=ENV)


def git_push() -> bool:
    """push 失败自动重试（本机到 github.com 链路不稳，走 git 配置的代理）"""
    for attempt in range(4):
        r = subprocess.run(["git", "push"], cwd=ROOT, env=ENV,
                           capture_output=True, text=True)
        if r.returncode == 0:
            return True
        log(f"  git push 第 {attempt + 1} 次失败，15 秒后重试：{(r.stderr or '')[-150:]}")
        time.sleep(15)
    return False


def main() -> None:
    today = date.today()
    current_ym = today.strftime("%Y-%m")
    all_added: dict[str, list[str]] = {}

    for key, meta in ASSETS.items():
        data_file = DATA_DIR / f"{key}.json"
        data = json.loads(data_file.read_text(encoding="utf-8"))
        last = datetime.strptime(data[-1]["d"], "%Y-%m-%d").date()
        log(f"{key}（{meta['code']}）：现有 {len(data)} 条，最新 {last}")

        if meta["source"] == "ifind":
            new_rows = fetch_ifind(meta["code"], last - timedelta(days=45), today)
        else:
            new_rows = fetch_wind_index(meta["code"], last - timedelta(days=45), today)

        new_rows = [r for r in new_rows if r["d"][:7] != current_ym]
        existing = {r["d"] for r in data}
        added = [r for r in new_rows if r["d"] not in existing]
        if not added:
            log(f"  {key} 无新数据")
            continue
        merged = sorted(data + added, key=lambda r: r["d"])
        data_file.write_text(json.dumps(merged, separators=(",", ":")), encoding="utf-8")
        all_added[key] = [r["d"] for r in added]
        log(f"  {key} 新增 {len(added)} 条：{[r['d'] for r in added]}，总计 {len(merged)} 条")

    if not all_added:
        log("所有标的均无新数据，本次不部署。结束。")
        return

    log("提交新数据并推送到 GitHub ...")
    run_git("add", "src/data")
    summary = ", ".join(f"{k}+{len(v)}" for k, v in all_added.items())
    run_git("commit", "-m", f"data: monthly update ({summary})")
    if git_push():
        log("已推送。GitHub Pages / Cloudflare / Vercel / EdgeOne 将自动构建部署。")
    else:
        log("⚠️ git push 多次失败：提交保留在本地，下次运行时会自动补推。")
        log("  如需手动推送：cd 项目目录后执行 git push（需代理，端口见 git config http.proxy）")


if __name__ == "__main__":
    main()
