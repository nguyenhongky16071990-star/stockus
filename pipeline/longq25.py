"""Lịch sử dài (từ 2020) của "số mã tăng / giảm ≥ 25% trong một quý".

Gói Massive miễn phí chỉ có khoảng 2 năm, nên phần lịch sử dài được tính từ giá Yahoo của chính danh sách cổ phiếu
đang quét. Giới hạn cần biết: chỉ gồm các mã CÒN niêm yết hôm nay (mã đã hủy niêm yết, thường là mã giảm mạnh,
không có trong dữ liệu) nên số mã giảm ≥ 25% ở các năm cũ, nhất là 2022, bị đếm THẤP hơn thực tế.
Kết quả được lưu đệm và chỉ tải lại mỗi 30 ngày.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "pipeline" / "cache" / "q25long.json"
START = "2019-06-01"


def _from_panels(C: pd.DataFrame, V: pd.DataFrame, min_price=3.0, min_dv=2e6) -> list:
    r63 = C / C.shift(63) - 1
    dv = (C * V).rolling(20, min_periods=10).mean()
    valid = C.notna() & C.shift(63).notna() & (C >= min_price) & (dv >= min_dv)
    up = ((r63 >= 0.25) & valid).sum(axis=1)
    dn = ((r63 <= -0.25) & valid).sum(axis=1)
    n = valid.sum(axis=1)
    keep = n >= 200
    return [[d.strftime("%Y-%m-%d"), int(u), int(w), int(k)] for d, u, w, k, ok in zip(C.index, up, dn, n, keep) if ok and d >= pd.Timestamp("2020-01-01")]


def _download(tickers: list[str], minutes: float = 15) -> tuple[pd.DataFrame, pd.DataFrame] | None:
    try:
        import yfinance as yf
    except Exception:
        return None
    t_end = time.time() + minutes * 60
    closes, vols = [], []
    for k in range(0, len(tickers), 200):
        if time.time() > t_end:
            print("Lịch sử dài: hết thời gian, dùng phần đã tải", file=sys.stderr)
            break
        chunk = [t.replace(".", "-") for t in tickers[k:k + 200]]
        try:
            df = yf.download(chunk, start=START, interval="1d", auto_adjust=True, progress=False, threads=True, group_by="column")
        except Exception as e:
            print("Lịch sử dài: lỗi tải", e, file=sys.stderr)
            continue
        if df is None or df.empty:
            continue
        c, v = df.get("Close"), df.get("Volume")
        if isinstance(c, pd.Series):
            c, v = c.to_frame(chunk[0]), v.to_frame(chunk[0])
        closes.append(c)
        vols.append(v)
    if not closes:
        return None
    C = pd.concat(closes, axis=1)
    V = pd.concat(vols, axis=1).reindex_like(C)
    return C.sort_index(), V.sort_index()


def compute(tickers: list[str], fallback: tuple[pd.DataFrame, pd.DataFrame] | None = None, demo: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    if not demo and CACHE.exists():
        try:
            c = json.loads(CACHE.read_text())
            age = (now - datetime.fromisoformat(c["built"])).days
            if age < 30 and len(c.get("rows", [])) > 500:
                return c
        except Exception:
            pass
    src, panels = "Yahoo (danh sách cổ phiếu đang quét)", None if demo else _download(sorted(tickers))
    if panels is None or panels[0].shape[1] < 300:
        if fallback is None:
            return {}
        panels, src = fallback, "dữ liệu của trang (ngắn)"
    rows = _from_panels(*panels)
    out = {"built": now.isoformat(), "src": src, "n_tickers": int(panels[0].shape[1]), "rows": rows,
           "note": "Chỉ gồm các mã còn niêm yết hôm nay: mã đã hủy niêm yết (thường giảm mạnh) không có, nên số mã giảm ≥ 25% ở các năm cũ bị đếm thấp hơn thực tế."}
    if not demo and src.startswith("Yahoo"):
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(out))
    return out
