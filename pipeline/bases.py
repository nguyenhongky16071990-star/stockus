"""Nhận diện NỀN GIÁ (vùng tích lũy đi ngang) cho các phương pháp mua tại pivot.

Một vùng w phiên được coi là nền khi:
  * độ sâu (đỉnh − đáy) / đỉnh không quá giới hạn (35% với nền kiểu Minervini/O'Neil, 25% với nền kiểu Qullamaggie);
  * phía trái của nền đã có đỉnh gần ngang đỉnh nền (≥ 90%): giá đã từng lên tới vùng đó rồi đi ngang/điều chỉnh,
    chứ không phải một mạch tăng thẳng (mạch tăng thẳng không phải nền, mua lúc đó là mua đuổi);
  * giá hiện tại nằm sát đỉnh nền (trong 8% với nền dài, 5% với nền ngắn kiểu Qullamaggie).
Pivot = đỉnh của nền dài nhất thỏa điều kiện.
VCP (Minervini): nền ≥ 15 phiên, 10 phiên cuối biên độ ≤ 10% và hẹp hơn đoạn trước đó, khối lượng 10 phiên < trung bình 50 phiên.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

WINS = (15, 20, 25, 30, 40, 50, 65)
QWINS = (8, 10, 15, 20, 30, 40)


def frames(H: pd.DataFrame, L: pd.DataFrame, C: pd.DataFrame, V: pd.DataFrame, v50: pd.DataFrame) -> dict:
    blen = pd.DataFrame(0.0, index=C.index, columns=C.columns)
    bpiv = pd.DataFrame(np.nan, index=C.index, columns=C.columns)
    bdep = pd.DataFrame(np.nan, index=C.index, columns=C.columns)
    for w in WINS:
        hw, lw = H.rolling(w, min_periods=w).max(), L.rolling(w, min_periods=w).min()
        left = H.shift(w - 5).rolling(5, min_periods=3).max()
        dep = (hw - lw) / hw
        ok = (dep <= 0.35) & (left >= 0.90 * hw) & (C >= 0.92 * hw)
        blen = blen.mask(ok, float(w))
        bpiv = bpiv.mask(ok, hw)
        bdep = bdep.mask(ok, dep * 100)
    piv = bpiv
    r10 = (H.rolling(10).max() - L.rolling(10).min()) / piv
    rprev = (H.shift(10).rolling(15, min_periods=10).max() - L.shift(10).rolling(15, min_periods=10).min()) / piv
    vcp = (blen >= 15) & (r10 <= 0.10) & (r10 < rprev) & (V.rolling(10).mean() < v50)
    # nền ngắn kiểu Qullamaggie: tích lũy 2–8 tuần sau nhịp tăng, sát đỉnh vùng tích lũy
    qb = pd.DataFrame(False, index=C.index, columns=C.columns)
    qpiv = pd.DataFrame(np.nan, index=C.index, columns=C.columns)
    for w in QWINS:
        hw, lw = H.rolling(w, min_periods=w).max(), L.rolling(w, min_periods=w).min()
        left = H.shift(w - 3).rolling(3, min_periods=2).max()
        ok = ((hw - lw) / hw <= 0.25) & (left >= 0.90 * hw) & (C >= 0.95 * hw)
        qb = qb | ok
        qpiv = qpiv.mask(ok, hw)
    return {"blen": blen, "bpiv": bpiv, "bdep": bdep, "vcp": vcp.fillna(False), "qb": qb.fillna(False), "qpiv": qpiv}
