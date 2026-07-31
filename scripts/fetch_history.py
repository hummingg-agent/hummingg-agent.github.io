#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一次性历史数据抓取脚本：为每个资产生成 src/data/<key>.json

资产注册表（key → 数据源/代码）：
  qqq    QQQ.O        纳斯达克100 ETF   iFinD（复用现有 src/qqq_monthly.json）
  spx    SPX.GI       标普500指数       Wind index_data（5 年窗口分块）
  hs300  000300.SH    沪深300指数       iFinD（3 年窗口分块）
  zz500  000905.SH    中证500指数       iFinD（3 年窗口分块）
  hsi    HSI.HI       恒生指数          Wind index_data（分块）

注：SPY/VOO 等美股 ETF（除 QQQ.O 外）在 iFinD 与 Wind 插件均取不到长期月线，
故美股标普500敞口用 SPX.GI 指数代替。

输出格式与 qqq_monthly.json 一致：[{"d":"YYYY-MM-DD","c":close}, ...]
只保留已完结月份的 K 线。
"""
import csv
import io
import json
import re
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
TMP_DIR = ROOT / "tmp"

IFIND_TOOL = Path.home() / (
    "Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/"
    "kimi-code/home/plugins/managed/ifind/scripts/ifind_tool.py"
)
WIND_CLI = Path.home() / (
    "Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/"
    "kimi-code/home/plugins/managed/wind-allskill/skills/wind-mcp-skill/scripts/cli.mjs"
)

ASSETS = {
    "qqq": {"source": "existing", "name": "纳斯达克100 ETF (QQQ)"},
    "spx": {"source": "wind_index", "code": "SPX.GI", "name": "标普500指数", "begin": "1990-01-01"},
    "hs300": {"source": "ifind", "code": "000300.SH", "name": "沪深300指数", "begin": "2002-01-04"},
    "zz500": {"source": "ifind", "code": "000905.SH", "name": "中证500指数", "begin": "2004-12-31"},
    "hsi": {"source": "wind_index", "code": "HSI.HI", "name": "恒生指数", "begin": "1990-01-01"},
}


def log(msg: str) -> None:
    print(f"[fetch_history] {msg}", flush=True)


def current_ym() -> str:
    return date.today().strftime("%Y-%m")


def write_json(key: str, rows: list[dict]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    rows = [r for r in rows if r["d"][:7] != current_ym()]
    rows.sort(key=lambda r: r["d"])
    # 去重（保留最后出现的）
    dedup = {r["d"]: r for r in rows}
    rows = [dedup[d] for d in sorted(dedup)]
    out = DATA_DIR / f"{key}.json"
    out.write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
    log(f"{key}: {len(rows)} 条 {rows[0]['d']} ~ {rows[-1]['d']} -> {out.relative_to(ROOT)}")


def parse_wind_csv_text(text: str) -> list[dict]:
    rows = []
    reader = csv.DictReader(io.StringIO(text))
    for r in reader:
        if not r.get("trade_date") or not r.get("close"):
            continue
        rows.append({"d": r["trade_date"][:10], "c": round(float(r["close"]), 4)})
    return rows


def fetch_wind_chunked(server: str, tool: str, code: str, begin: date, end: date) -> list[dict]:
    """Wind K 线单次约百条上限，按 5 年窗口分块"""
    rows: list[dict] = []
    chunk_start = begin
    while chunk_start <= end:
        chunk_end = min(chunk_start + timedelta(days=365 * 5 - 1), end)
        params = {
            "windcode": code,
            "begin_date": chunk_start.strftime("%Y%m%d"),
            "end_date": chunk_end.strftime("%Y%m%d"),
            "period": "12",
        }
        csv_path = None
        for attempt in range(3):
            r = subprocess.run(
                ["node", str(WIND_CLI), "call", server, tool, json.dumps(params)],
                capture_output=True, text=True, timeout=600,
            )
            out = r.stdout + r.stderr
            m = re.search(r"saved to (/\S+?\.csv)", out)
            if m and Path(m.group(1)).exists():
                csv_path = Path(m.group(1))
                break
            log(f"  Wind {code} {chunk_start}~{chunk_end} 第 {attempt + 1} 次失败，重试")
        if csv_path is None:
            raise SystemExit(f"Wind 拉取 {code} 失败：{out[-600:]}")
        rows.extend(parse_wind_csv_text(csv_path.read_text(encoding="utf-8")))
        log(f"  Wind {code} {chunk_start} ~ {chunk_end} OK（累计 {len(rows)} 条）")
        chunk_start = chunk_end + timedelta(days=1)
    return rows


def parse_ifind_csv(path: Path) -> list[dict]:
    rows = []
    lines = path.read_text(encoding="utf-8").splitlines()
    header = lines[0].split(",")
    for line in lines[1:]:
        if not line.strip():
            continue
        cols = dict(zip(header, line.split(",")))
        if not cols.get("time") or not cols.get("close"):
            continue
        rows.append({"d": cols["time"][:10], "c": round(float(cols["close"]), 4)})
    return rows


def fetch_ifind_chunked(code: str, begin: date, end: date) -> list[dict]:
    """iFinD 单次最多 3 年，分块拉取"""
    TMP_DIR.mkdir(exist_ok=True)
    rows: list[dict] = []
    chunk_start = begin
    while chunk_start <= end:
        chunk_end = min(chunk_start + timedelta(days=365 * 3 - 1), end)
        csv_path = TMP_DIR / f"ifind_{code.replace('.', '_')}.csv"
        if csv_path.exists():
            csv_path.unlink()
        params = {
            "ticker": code,
            "start_date": chunk_start.isoformat(),
            "end_date": chunk_end.isoformat(),
            "interval": "M",
            "adjust": "forward",
            "file_path": str(csv_path).replace("\\", "/"),
        }
        for attempt in range(3):
            r = subprocess.run(
                [sys.executable, str(IFIND_TOOL), "call",
                 "--api-name", "ifind_get_price",
                 "--params-json", json.dumps(params)],
                capture_output=True, text=True, timeout=300,
            )
            if r.returncode == 0 and csv_path.exists():
                break
            log(f"  iFinD {code} {chunk_start}~{chunk_end} 第 {attempt + 1} 次失败，重试")
        else:
            raise SystemExit(f"iFinD 拉取 {code} 失败：{r.stdout[-400:]} {r.stderr[-400:]}")
        rows.extend(parse_ifind_csv(csv_path))
        log(f"  iFinD {code} {chunk_start} ~ {chunk_end} OK（累计 {len(rows)} 条）")
        chunk_start = chunk_end + timedelta(days=1)
    return rows


def main() -> None:
    today = date.today()
    only = set(sys.argv[1:])  # 可指定只抓某些 key，如：python3 scripts/fetch_history.py hs300
    for key, meta in ASSETS.items():
        if only and key not in only:
            continue
        log(f"=== {key} {meta['name']} ===")
        if meta["source"] == "existing":
            rows = json.loads((ROOT / "src" / "qqq_monthly.json").read_text(encoding="utf-8"))
        elif meta["source"] == "ifind":
            begin = datetime.strptime(meta["begin"], "%Y-%m-%d").date()
            rows = fetch_ifind_chunked(meta["code"], begin, today)
        elif meta["source"] == "wind_fund":
            begin = datetime.strptime(meta["begin"], "%Y-%m-%d").date()
            rows = fetch_wind_chunked("fund_data", "get_fund_kline", meta["code"], begin, today)
        elif meta["source"] == "wind_index":
            begin = datetime.strptime(meta["begin"], "%Y-%m-%d").date()
            rows = fetch_wind_chunked("index_data", "get_index_kline", meta["code"], begin, today)
        else:
            raise SystemExit(f"未知数据源：{meta['source']}")
        write_json(key, rows)


if __name__ == "__main__":
    main()
