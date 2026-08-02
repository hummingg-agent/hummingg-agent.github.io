#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一次性历史数据全量重建：为每个资产生成 src/data/<key>.json（月线）+ <key>_daily.json（日线）。

数据源：global_index_collector（免费源：新浪 / 东方财富 / AkShare。原 iFinD / Wind 付费源已移除）。
流程：
  1. 运行 collector 的 main.py update（免费源抓取，带限速 / 防封，写入 SQLite）
  2. 运行 export_dca.py 从 SQLite 导出成站点所需格式
输出格式与旧版一致：[{"d":"YYYY-MM-DD","c":close}, ...]，月线仅保留已完结月份。

依赖：global_index_collector 环境（含 akshare 的 python，见 COLLECTOR_PY）。
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# collector 工程目录与 python（含 akshare 的虚拟环境）
COLLECTOR_DIR = Path("/Users/hummingg/WorkBuddy/2026-08-01-18-22-16/global_index_collector")
COLLECTOR_PY = Path("/Users/hummingg/.workbuddy/binaries/python/envs/default/bin/python")

# 资产注册表（仅作文档 / 起点参考；实际覆盖范围由 collector 的 build_indexes 决定）
ASSETS = {
    "qqq":   {"name": "纳斯达克100 ETF", "begin": "1999-03-10"},
    "spx":   {"name": "标普500",         "begin": "1990-01-01"},
    "hs300": {"name": "沪深300",         "begin": "2002-01-04"},
    "zz500": {"name": "中证500",         "begin": "2004-12-31"},
    "hsi":   {"name": "恒生指数",         "begin": "1990-01-01"},
}


def log(msg: str) -> None:
    print(f"[fetch_history] {msg}", flush=True)


def run(cmd: list) -> int:
    log("执行: " + " ".join(str(c) for c in cmd))
    return subprocess.run([str(c) for c in cmd], cwd=str(ROOT)).returncode


def main() -> None:
    log("=== 全量重建（免费源）===")
    # 1) 刷新 collector（免费源）
    if COLLECTOR_PY.exists():
        rc = run([COLLECTOR_PY, COLLECTOR_DIR / "main.py", "update"])
        if rc != 0:
            log("⚠️ collector update 返回非零，将使用现有 SQLite 继续导出")
    else:
        log(f"未找到 collector python：{COLLECTOR_PY}，跳过刷新（使用现有 SQLite）")
    # 2) 导出到 src/data
    dca_data = ROOT / "src" / "data"
    if COLLECTOR_PY.exists():
        rc = run([COLLECTOR_PY, COLLECTOR_DIR / "export_dca.py",
                  COLLECTOR_DIR / "global_index.db", dca_data])
    else:
        rc = run([sys.executable, COLLECTOR_DIR / "export_dca.py",
                  COLLECTOR_DIR / "global_index.db", dca_data])
    if rc != 0:
        log("⚠️ 导出失败")
        return
    log("=== 完成：已用免费源重建 src/data ===")


if __name__ == "__main__":
    main()
