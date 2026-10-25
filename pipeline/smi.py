"""Điểm mua trung hạn: SMI tuần (Stochastic Momentum Index 10-3-3) quá bán rồi cắt lên.

Kiểm chứng trên QQQ tuần từ 1999 (Yahoo): tín hiệu một mình không hơn mua bất kỳ lúc nào, nhưng khi giá còn cách đỉnh
52 tuần dưới 20% và là tín hiệu thứ 1–2 trong năm (nhịp điều chỉnh trong xu hướng tăng) thì 3 tháng sau thắng ~72%,
1 năm sau trung bình +15%. Khi giá cách đỉnh 20–30% (thị trường đang chuyển sang giá xuống) thì gần như luôn thua.
Mọi số liệu ở đây được tính lại mỗi ngày từ dữ liệu thật, không ghi cứng.
"""
from __future__ import annotations

import math
import sys

import numpy as np
import pandas as pd

K, D, E = 10, 3, 3
OS = -40   # ngưỡng quá bán


def _r(x, d=1):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, d) if math.isfinite(x) else None


def _load_long(ticker: str = "QQQ") -> pd.DataFrame | None:
    try:
        import yfinance as yf
        df = yf.download(ticker, period="max", interval="1d", auto_adjust=False, progress=False, threads=False)
        if df is None or df.empty:
            return None
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        return df[["Open", "High", "Low", "Close"]].dropna()
    except Exception as e:
        print("SMI: không tải được lịch sử dài từ Yahoo:", e, file=sys.stderr)
        return None


def weekly(df: pd.DataFrame) -> pd.DataFrame:
    w = df.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
    w.index = w.index - pd.Timedelta(days=4)   # nhãn theo thứ Hai đầu tuần như TradingView
    return w


def smi(w: pd.DataFrame):
    hh, ll = w["High"].rolling(K).max(), w["Low"].rolling(K).min()
    rd, df_ = w["Close"] - (hh + ll) / 2, hh - ll
    ema = lambda s, p: s.ewm(span=p, adjust=False).mean()
    ar, ad = ema(ema(rd, D), D), ema(ema(df_, D), D)
    s = 200 * ar / ad
    return s, ema(s, E)


def compute(fallback: pd.DataFrame | None = None, long: pd.DataFrame | None = None) -> dict:
    src = "Yahoo (từ 1999)"
    df = long if long is not None else _load_long()
    if df is None or len(df) < 600:
        df, src = fallback, "dữ liệu của trang (ngắn)"
    if df is None or len(df) < 120:
        return {}
    w = weekly(df)
    s, sg = smi(w)
    c, h = w["Close"], w["High"]
    hi52 = h.rolling(52, min_periods=20).max()
    n = len(w)
    cross = (s > sg) & (s.shift(1) <= sg.shift(1)) & (np.minimum(s, s.shift(1)) < OS)
    idx = [i for i in np.nonzero(cross.fillna(False).values)[0] if i >= 30]
    sig = []
    for k, i in enumerate(idx):
        nth = 1 + sum(1 for j in idx[:k] if j >= i - 52)
        dd = c.iloc[i] / hi52.iloc[i] - 1
        f = lambda m: (c.iloc[i + m] / c.iloc[i] - 1) * 100 if i + m < n else None
        lo13 = w["Low"].iloc[i + 1:i + 14].min() if i + 1 < n else np.nan
        grp = "Tốt" if dd > -0.20 and nth <= 2 else ("Tránh" if dd > -0.30 else "Chờ xác nhận")
        sig.append({"d": w.index[i].strftime("%Y-%m-%d"), "c": _r(c.iloc[i], 2), "smi": _r(s.iloc[i], 0), "dd52": _r(dd * 100),
                    "nth": nth, "grp": grp, "w4": _r(f(4)), "w13": _r(f(13)), "w26": _r(f(26)), "w52": _r(f(52)),
                    "mdd13": _r((lo13 / c.iloc[i] - 1) * 100) if np.isfinite(lo13) else None})

    def st(rows, key):
        a = [r[key] for r in rows if r[key] is not None]
        return {"n": len(a), "avg": _r(np.mean(a)) if a else None, "win": _r(np.mean([x > 0 for x in a]) * 100, 0) if a else None}

    base = {}
    for m in (13, 52):
        a = [(c.iloc[i + m] / c.iloc[i] - 1) * 100 for i in range(30, n - m)]
        base[f"w{m}"] = {"n": len(a), "avg": _r(np.mean(a)) if a else None, "win": _r(np.mean([x > 0 for x in a]) * 100, 0) if a else None}
    groups = []
    for g, desc in (("Tốt", "Cách đỉnh 52 tuần < 20% và là tín hiệu thứ 1–2 trong năm"), ("Tránh", "Cách đỉnh 20–30%: thị trường đang chuyển sang giá xuống"),
                    ("Chờ xác nhận", "Cách đỉnh > 30% hoặc tín hiệu thứ 3 trở lên trong năm: chờ ngày xác nhận tăng"), ("Tất cả", "Mọi tín hiệu")):
        rows = sig if g == "Tất cả" else [r for r in sig if r["grp"] == g]
        mdd = [r["mdd13"] for r in rows if r["mdd13"] is not None]
        groups.append({"g": g, "desc": desc, "n": len(rows), "w13": st(rows, "w13"), "w26": st(rows, "w26"), "w52": st(rows, "w52"),
                       "mdd13": _r(np.mean(mdd)) if mdd else None})
    i = n - 1
    nth_now = 1 + sum(1 for j in idx if j >= i - 52)
    dd_now = c.iloc[i] / hi52.iloc[i] - 1
    now = {"d": w.index[i].strftime("%Y-%m-%d"), "smi": _r(s.iloc[i], 0), "sig": _r(sg.iloc[i], 0), "dd52": _r(dd_now * 100),
           "oversold": bool(s.iloc[i] < OS), "nth_next": nth_now,
           "grp_if": "Tốt" if dd_now > -0.20 and nth_now <= 2 else ("Tránh" if dd_now > -0.30 else "Chờ xác nhận"),
           "last": sig[-1] if sig else None, "weeks_since": int(i - idx[-1]) if idx else None}
    tail = w.iloc[-400:]
    st_, sg_ = s.iloc[-400:], sg.iloc[-400:]
    series = [[d.strftime("%Y-%m-%d"), _r(o, 2), _r(hh, 2), _r(lw, 2), _r(cl, 2), _r(a, 1), _r(b, 1)]
              for d, o, hh, lw, cl, a, b in zip(tail.index, tail["Open"], tail["High"], tail["Low"], tail["Close"], st_, sg_)]
    return {"src": src, "from": w.index[30].strftime("%Y-%m-%d"), "to": w.index[-1].strftime("%Y-%m-%d"), "base": base,
            "groups": groups, "signals": sig, "now": now, "series": series}
