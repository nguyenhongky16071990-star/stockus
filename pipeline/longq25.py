"""Độ rộng thị trường dài hạn (từ 2020): các chỉ báo trong bảng Market Monitor của Stockbee và độ rộng kinh điển.

Mỗi dòng: [ngày, QQQ, tăng≥25%/quý, giảm≥25%/quý, tăng≥13%/34 phiên, giảm≥13%/34 phiên, tăng≥25%/tháng, giảm≥25%/tháng,
           tăng≥50%/tháng, % mã trên MA40 (T2108), số đỉnh mới 52 tuần, số đáy mới 52 tuần, số mã tăng, số mã giảm, tổng số mã]

Gói Massive miễn phí chỉ có khoảng 2 năm, nên phần trước đó được tính từ giá Yahoo của chính danh sách cổ phiếu đang quét.
Giới hạn: chỉ gồm các mã CÒN niêm yết hôm nay (mã đã hủy niêm yết, thường là mã giảm mạnh, không có), nên các chỉ số phía
"giảm" ở những năm cũ, nhất là 2022, bị đếm THẤP hơn thực tế. Phần Yahoo được lưu đệm và chỉ tải lại mỗi 30 ngày;
phần gần đây luôn tính lại từ dữ liệu của trang bằng cùng một công thức.
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
START = "2019-01-01"
COLS = ["d", "qqq", "up25q", "dn25q", "up13", "dn13", "up25m", "dn25m", "up50m", "t2108", "nh", "nl", "adv", "dec", "n"]


def _from_panels(C: pd.DataFrame, V: pd.DataFrame, qqq: pd.Series | None, min_price=3.0, min_dv=2e6, since="2020-01-01") -> list:
    dv = (C * V).rolling(20, min_periods=10).mean()
    base = C.notna() & (C >= min_price) & (dv >= min_dv)
    r = lambda k: C / C.shift(k) - 1
    cnt = lambda m, k: (m & base & C.shift(k).notna()).sum(axis=1)
    r63, r34, r21 = r(63), r(34), r(21)
    s40 = C.rolling(40, min_periods=40).mean()
    hi, lo = C.rolling(252, min_periods=200).max(), C.rolling(252, min_periods=200).min()
    n = (base & C.shift(63).notna()).sum(axis=1)
    cols = {
        "up25q": cnt(r63 >= 0.25, 63), "dn25q": cnt(r63 <= -0.25, 63),
        "up13": cnt(r34 >= 0.13, 34), "dn13": cnt(r34 <= -0.13, 34),
        "up25m": cnt(r21 >= 0.25, 21), "dn25m": cnt(r21 <= -0.25, 21), "up50m": cnt(r21 >= 0.50, 21),
        "t2108": ((C > s40) & base & s40.notna()).sum(axis=1) / (base & s40.notna()).sum(axis=1).replace(0, np.nan) * 100,
        "nh": ((C >= hi) & base & hi.notna()).sum(axis=1), "nl": ((C <= lo) & base & lo.notna()).sum(axis=1),
        "adv": ((C > C.shift(1)) & base).sum(axis=1), "dec": ((C < C.shift(1)) & base).sum(axis=1),
    }
    q = qqq.reindex(C.index) if qqq is not None else pd.Series(np.nan, index=C.index)
    out = []
    for i, d in enumerate(C.index):
        if d < pd.Timestamp(since) or n.iloc[i] < 200:
            continue
        row = [d.strftime("%Y-%m-%d"), None if pd.isna(q.iloc[i]) else round(float(q.iloc[i]), 2)]
        for k in COLS[2:-1]:
            v = cols[k].iloc[i]
            row.append(None if pd.isna(v) else (round(float(v), 1) if k == "t2108" else int(v)))
        row.append(int(n.iloc[i]))
        out.append(row)
    return out


def _download(tickers: list[str], minutes: float = 15):
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
    C = C.loc[:, ~C.columns.duplicated()].sort_index()
    V = pd.concat(vols, axis=1)
    V = V.loc[:, ~V.columns.duplicated()].reindex_like(C)
    return C, V


def compute(tickers: list[str], fallback=None, demo: bool = False) -> dict:
    """fallback = (C, V, qqq) của dữ liệu trang: dùng cho phần gần đây (và cho toàn bộ nếu không tải được Yahoo)."""
    now = datetime.now(timezone.utc)
    old, src_old, n_old = [], None, 0
    if not demo and CACHE.exists():
        try:
            c = json.loads(CACHE.read_text())
            if c.get("cols") == COLS and (now - datetime.fromisoformat(c["built"])).days < 30:
                old, src_old, n_old = c["rows"], c["src"], c["n_tickers"]
        except Exception:
            pass
    if not old and not demo:
        p = _download(sorted(set(tickers)) + ["QQQ"])
        if p is not None and p[0].shape[1] >= 300:
            C, V = p
            q = C["QQQ"] if "QQQ" in C else None
            C, V = C.drop(columns=["QQQ"], errors="ignore"), V.drop(columns=["QQQ"], errors="ignore")
            old, src_old, n_old = _from_panels(C, V, q), "Yahoo (danh sách cổ phiếu đang quét)", int(C.shape[1])
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps({"built": now.isoformat(), "cols": COLS, "src": src_old, "n_tickers": n_old, "rows": old}))
    recent = _from_panels(*fallback, since="2000-01-01") if fallback is not None else []
    first = recent[0][0] if recent else "9999"
    rows = [r for r in old if r[0] < first] + recent
    if not rows:
        return {}
    return {"cols": COLS, "rows": rows, "split": first if old else None, "src": src_old or "dữ liệu của trang",
            "n_tickers": n_old or (int(fallback[0].shape[1]) if fallback is not None else 0),
            "note": "Chỉ gồm các mã còn niêm yết hôm nay: mã đã hủy niêm yết (thường giảm mạnh) không có, nên các chỉ số phía giảm ở những năm cũ bị đếm thấp hơn thực tế."}
