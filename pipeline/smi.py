"""Điểm mua trung hạn: SMI tuần (Stochastic Momentum Index 5-3-3) quá bán rồi cắt lên.

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

K, D, E = 5, 3, 3   # theo cài đặt của người dùng (trước đây 10-3-3)
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


def live_daily(df: pd.DataFrame) -> pd.DataFrame:
    """SMI tuần như người dùng nhìn trên TradingView TRONG tuần: nến tuần đang chạy (chưa đóng) được tính đến phiên hôm đó.
    Không nhìn trước tương lai: giá trị của mỗi ngày chỉ dùng dữ liệu đến hết ngày đó. Ngày cuối tuần = đúng giá trị tuần đã đóng."""
    df = df[["High", "Low", "Close"]].dropna()
    wk = df.index.to_period("W-FRI")
    g = df.groupby(wk)
    Hw, Lw = g["High"].max().values, g["Low"].min().values
    keys = list(g.groups.keys())
    pos = {k: j for j, k in enumerate(sorted(keys))}
    Hw, Lw = g["High"].max().sort_index().values, g["Low"].min().sort_index().values
    Cw = g["Close"].last().sort_index().values
    nW = len(Cw)
    a, aE = 2 / (D + 1), 2 / (E + 1)
    E1r, E2r, E1d, E2d, SG = (np.full(nW, np.nan) for _ in range(5))
    for j in range(nW):
        if j < K - 1:
            continue
        hh, ll = Hw[j - K + 1:j + 1].max(), Lw[j - K + 1:j + 1].min()
        rd, dd = Cw[j] - (hh + ll) / 2, hh - ll
        if np.isnan(E1r[j - 1]) if j > 0 else True:
            E1r[j], E2r[j], E1d[j], E2d[j] = rd, rd, dd, dd
        else:
            E1r[j] = a * rd + (1 - a) * E1r[j - 1]; E2r[j] = a * E1r[j] + (1 - a) * E2r[j - 1]
            E1d[j] = a * dd + (1 - a) * E1d[j - 1]; E2d[j] = a * E1d[j] + (1 - a) * E2d[j - 1]
        sm = 200 * E2r[j] / E2d[j] if E2d[j] else np.nan
        SG[j] = sm if (j == 0 or np.isnan(SG[j - 1])) else aE * sm + (1 - aE) * SG[j - 1]
    H, L, C = df["High"].values, df["Low"].values, df["Close"].values
    ph, pl, last = -np.inf, np.inf, None
    out_s, out_g = np.full(len(df), np.nan), np.full(len(df), np.nan)
    for i in range(len(df)):
        j = pos[wk[i]]
        if j != last:
            ph, pl, last = -np.inf, np.inf, j
        ph, pl = max(ph, H[i]), min(pl, L[i])
        if j < K or np.isnan(E1r[j - 1]) or np.isnan(SG[j - 1]):
            continue
        hh, ll = max(ph, Hw[j - K + 1:j].max()), min(pl, Lw[j - K + 1:j].min())
        rd, dd = C[i] - (hh + ll) / 2, hh - ll
        e1r = a * rd + (1 - a) * E1r[j - 1]; e2r = a * e1r + (1 - a) * E2r[j - 1]
        e1d = a * dd + (1 - a) * E1d[j - 1]; e2d = a * e1d + (1 - a) * E2d[j - 1]
        if not e2d:
            continue
        sm = 200 * e2r / e2d
        out_s[i], out_g[i] = sm, aE * sm + (1 - aE) * SG[j - 1]
    return pd.DataFrame({"smi": out_s, "sig": out_g}, index=df.index)


def gate_test(df: pd.DataFrame, since: str | None = None) -> dict:
    """Kiểm chứng quy tắc của người dùng trên QQQ ngày: chỉ mua khi SMI tuần (đang chạy) nằm TRÊN đường tín hiệu."""
    dl = live_daily(df)
    c = df["Close"].reindex(dl.index)
    n = len(c)
    up = (dl["smi"] > dl["sig"]).values
    ok = dl["smi"].notna().values
    cv = c.values
    i0 = 0 if since is None else int(np.searchsorted(dl.index.values, np.datetime64(since)))
    def row(name, I):
        f = [(cv[i + 63] / cv[i] - 1) * 100 for i in I if i + 63 < n]
        f21 = [(cv[i + 21] / cv[i] - 1) * 100 for i in I if i + 21 < n]
        dd = [(cv[i + 1:i + 64].min() / cv[i] - 1) * 100 for i in I if i + 63 < n]
        return {"name": name, "n": len(I), "share": None, "f21": _r(np.mean(f21)) if f21 else None, "f63": _r(np.mean(f)) if f else None,
                "win": _r(np.mean([x > 0 for x in f]) * 100, 0) if f else None, "bad": _r(np.mean([x < -10 for x in dd]) * 100, 0) if dd else None}
    allI = [i for i in range(max(i0, 30), n) if ok[i]]
    onI = [i for i in allI if up[i]]
    offI = [i for i in allI if not up[i]]
    crossI = [i for i in allI if up[i] and i > 0 and not up[i - 1]]
    rows = [row("Mua bất kỳ ngày nào", allI), row("SMI tuần TRÊN đường tín hiệu (được mua)", onI),
            row("SMI tuần DƯỚI đường tín hiệu (không mua)", offI), row("Ngày SMI vừa cắt lên", crossI)]
    for r, I in zip(rows, (allI, onI, offI, crossI)):
        r["share"] = _r(len(I) / len(allI) * 100, 0) if allI else None
    flips = int(sum(1 for i in allI[1:] if up[i] != up[i - 1]))
    yrs = len(allI) / 252 if allI else 1
    return {"from": dl.index[allI[0]].strftime("%Y-%m-%d") if allI else None, "rows": rows, "flips_per_year": _r(flips / yrs, 1)}


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
    gates = {}
    try:
        gates = {"long": gate_test(df), "since2020": gate_test(df, "2020-01-01")}
    except Exception as e:
        print("SMI: lỗi kiểm chứng quy tắc mua:", e, file=sys.stderr)
    tail = w.iloc[-400:]
    st_, sg_ = s.iloc[-400:], sg.iloc[-400:]
    series = [[d.strftime("%Y-%m-%d"), _r(o, 2), _r(hh, 2), _r(lw, 2), _r(cl, 2), _r(a, 1), _r(b, 1)]
              for d, o, hh, lw, cl, a, b in zip(tail.index, tail["Open"], tail["High"], tail["Low"], tail["Close"], st_, sg_)]
    return {"src": src, "from": w.index[30].strftime("%Y-%m-%d"), "to": w.index[-1].strftime("%Y-%m-%d"), "base": base,
            "groups": groups, "signals": sig, "now": now, "series": series, "gates": gates}
