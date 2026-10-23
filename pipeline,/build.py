"""Nhiệt kế thị trường — bộ tính toán chạy mỗi ngày.

Tải giá ngày của danh sách cổ phiếu trong universe.csv, tính 5 lớp dữ liệu theo
Martin Luk, Qullamaggie, Minervini, O'Neil, Weinstein, Stockbee, Oliver Kell,
rồi ghi các file JSON vào docs/data cho trang web đọc.

Chạy:  python pipeline/build.py            (dữ liệu thật: Massive nếu có biến MASSIVE_API_KEY,
                                             nếu không thì Yahoo Finance với universe.csv)
       python pipeline/build.py --demo     (dữ liệu giả lập để xem thử giao diện)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"
CONFIG = json.loads((ROOT / "pipeline" / "config.json").read_text(encoding="utf-8"))
INDEXES = ["QQQ", "SPY", "IWM", "SMH", "IGV"]
FIELDS = ["Open", "High", "Low", "Close", "Volume"]
APP_VERSION = "2026.10.24"  # phải trùng với APP_VERSION trong docs/app.js


# ---------------------------------------------------------------- tải dữ liệu
def load_universe() -> pd.DataFrame:
    u = pd.read_csv(ROOT / "pipeline" / "universe.csv", dtype=str).dropna()
    u["ticker"] = u["ticker"].str.strip().str.upper()
    return u.drop_duplicates("ticker")


def fetch_chart_api(ticker: str, years: int) -> pd.DataFrame | None:
    """Dự phòng: gọi thẳng API biểu đồ của Yahoo."""
    import requests

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range={years}y&interval=1d"
    for attempt in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
            res = r.json()["chart"]["result"][0]
            q = res["indicators"]["quote"][0]
            idx = pd.to_datetime(res["timestamp"], unit="s", utc=True).tz_convert("America/New_York").normalize().tz_localize(None)
            df = pd.DataFrame({"Open": q["open"], "High": q["high"], "Low": q["low"], "Close": q["close"], "Volume": q["volume"]}, index=idx)
            return df.dropna(subset=["Close"])
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def download(tickers: list[str], years: int) -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    try:
        import yfinance as yf

        for i in range(0, len(tickers), 80):
            chunk = tickers[i : i + 80]
            raw = yf.download(chunk, period=f"{years}y", interval="1d", group_by="ticker",
                              auto_adjust=True, threads=True, progress=False)
            for t in chunk:
                try:
                    df = raw[t] if isinstance(raw.columns, pd.MultiIndex) else raw
                    df = df[FIELDS].dropna(subset=["Close"])
                    if len(df) > 20:
                        df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
                        out[t] = df
                except Exception:
                    pass
            time.sleep(1)
    except Exception as e:  # yfinance hỏng hoặc chưa cài
        print("yfinance lỗi:", e, file=sys.stderr)
    missing = [t for t in tickers if t not in out]
    for t in missing:
        df = fetch_chart_api(t, years)
        if df is not None and len(df) > 20:
            out[t] = df
        time.sleep(0.3)
    print(f"Tải được {len(out)}/{len(tickers)} mã")
    return out


def demo_data(tickers: list[str], days: int = 760) -> dict[str, pd.DataFrame]:
    """Dữ liệu giả lập có chu kỳ thị trường tăng/giảm để xem thử giao diện."""
    rng = np.random.default_rng(7)
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=days)
    phase = np.sin(np.linspace(0, 7 * np.pi, days))
    market = np.cumsum(0.0006 + 0.004 * phase / 3 + rng.normal(0, 0.009, days))
    out = {}
    for k, t in enumerate(tickers):
        beta = rng.uniform(0.6, 2.2)
        drift = rng.normal(0.0004, 0.0012)
        vol = rng.uniform(0.012, 0.045)
        lr = beta * np.diff(np.r_[0, market]) + drift + rng.normal(0, vol, days)
        c = 20 * math.exp(rng.uniform(0, 3)) * np.exp(np.cumsum(lr))
        o = c * np.exp(rng.normal(0, vol / 3, days))
        h = np.maximum(o, c) * np.exp(np.abs(rng.normal(0, vol / 2, days)))
        l = np.minimum(o, c) * np.exp(-np.abs(rng.normal(0, vol / 2, days)))
        v = rng.uniform(3e5, 2e7) * np.exp(rng.normal(0, 0.4, days))
        out[t] = pd.DataFrame({"Open": o, "High": h, "Low": l, "Close": c, "Volume": v}, index=idx)
    return out


# ---------------------------------------------------------------- tiện ích
def ema(df, n):
    return df.ewm(span=n, adjust=False, min_periods=n).mean()


def sma(df, n):
    return df.rolling(n, min_periods=n).mean()


def r1(x, d=1):
    if x is None:
        return None
    try:
        if isinstance(x, (np.bool_, bool)):
            return bool(x)
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, d)


def regime(c: pd.Series) -> pd.Series:
    """Xu hướng kiểu Martin: Tốt / Giằng co / Xấu."""
    e9, e21, e50 = ema(c, 9), ema(c, 21), ema(c, 50)
    up = e21 > e21.shift(5)
    good = (c > e21) & (e9 > e21) & up
    bad = ((c < e50) & ~up) | ((c < e21) & (e9 < e21) & ~up)
    return pd.Series(np.where(good, "Tốt", np.where(bad, "Xấu", "Giằng co")), index=c.index)


def distribution_days(c: pd.Series, v: pd.Series, window: int = 25) -> pd.Series:
    dd = (c.pct_change() <= -0.002) & (v > v.shift(1))
    return dd.rolling(window, min_periods=1).sum()


def follow_through(c: pd.Series, v: pd.Series):
    """Ngày xác nhận tăng (O'Neil). Trả về (ngày FTD gần nhất, mô tả trạng thái hiện tại)."""
    cv, vv = c.values, v.values
    hi60 = c.rolling(60, min_periods=20).max().values
    low_i = start = None
    last_ftd, status = None, "Không có nỗ lực hồi phục"
    for i in range(1, len(cv)):
        win_min = cv[max(0, i - 25) : i + 1].min()
        if cv[i] <= win_min and hi60[i] and cv[i] <= hi60[i] * 0.95:
            low_i, start = i, None
            status = "Chỉ số đang tạo đáy mới"
            continue
        if low_i is None:
            continue
        if start is None and cv[i] > cv[i - 1]:
            start = i
        if start is not None:
            day = i - start + 1
            status = f"Nỗ lực hồi phục ngày {day}"
            if day >= 4 and cv[i] / cv[i - 1] - 1 >= 0.0125 and vv[i] > vv[i - 1]:
                last_ftd = c.index[i]
                status = "Đã có ngày xác nhận tăng"
                low_i = start = None
    return last_ftd, status


def weinstein_stage(c: pd.Series) -> str:
    w = c.resample("W-FRI").last().dropna()
    s30 = w.rolling(30, min_periods=30).mean()
    if s30.notna().sum() < 6:
        return "Chưa đủ dữ liệu"
    slope = s30.iloc[-1] / s30.iloc[-5] - 1
    price = w.iloc[-1]
    if price > s30.iloc[-1] and slope > 0.005:
        return "Giai đoạn 2 (tăng)"
    if price < s30.iloc[-1] and slope < -0.005:
        return "Giai đoạn 4 (giảm)"
    prior_up = s30.iloc[-1] > s30.iloc[-21] if len(s30.dropna()) > 21 else True
    return "Giai đoạn 3 (tạo đỉnh)" if prior_up else "Giai đoạn 1 (tạo nền)"


def anchored_vwap(h, l, c, v, start: int) -> np.ndarray:
    tp = (h + l + c) / 3
    pv = np.nancumsum(np.where(np.arange(len(c)) >= start, tp * v, 0.0))
    vv = np.nancumsum(np.where(np.arange(len(c)) >= start, v, 0.0))
    out = np.where(np.arange(len(c)) >= start, pv / np.where(vv == 0, np.nan, vv), np.nan)
    return out


# ---------------------------------------------------------------- tính toán
class _Light(Exception):
    pass


def compute(raw: dict[str, pd.DataFrame], universe: pd.DataFrame, light: bool = False) -> dict:
    """light=True: bỏ qua kiểm chứng và chu kỳ (dùng khi chạy lại nhiều ngày cho danh mục mô phỏng)."""
    cfg = CONFIG
    if "QQQ" not in raw:
        raise SystemExit("Không tải được QQQ — dừng.")
    dates = raw["QQQ"].index
    theme = dict(zip(universe.ticker, universe.theme))
    names = dict(zip(universe.ticker, universe["name"])) if "name" in universe else {}
    industry = dict(zip(universe.ticker, universe["industry"])) if "industry" in universe else dict(theme)
    shares = dict(zip(universe.ticker, universe["shares"])) if "shares" in universe else {}
    stocks = [t for t in universe.ticker if t in raw]
    panel = {f: pd.DataFrame({t: raw[t][f].reindex(dates) for t in stocks}) for f in FIELDS}
    O, H, L, C, V = (panel[f] for f in FIELDS)
    qqq = raw["QQQ"].reindex(dates)

    e9, e21, e50 = ema(C, 9), ema(C, 21), ema(C, 50)
    s40, s50, s150, s200 = sma(C, 40), sma(C, 50), sma(C, 150), sma(C, 200)
    ret = {n: C / C.shift(n) - 1 for n in (1, 3, 5, 21, 63, 126, 189, 252)}
    adr = ((H / L) - 1).rolling(20, min_periods=15).mean() * 100
    dv = (C * V).rolling(20, min_periods=15).mean()
    v50 = V.rolling(50, min_periods=30).mean()
    hi20, lo20 = C.rolling(20, min_periods=20).max(), C.rolling(20, min_periods=20).min()
    hi252 = C.rolling(252, min_periods=200).max()
    lo252 = C.rolling(252, min_periods=200).min()
    hi_all = C.rolling(252, min_periods=20).max()  # đỉnh 1 năm, hoặc từ khi niêm yết với mã mới
    dd_hi = (C / hi_all - 1) * 100
    valid = C.notna() & C.shift(20).notna()  # từ 1 tháng sau niêm yết đã được xếp hạng

    perf = 0.4 * ret[63] + 0.2 * ret[126] + 0.2 * ret[189] + 0.2 * ret[252]
    perf = perf.where(ret[252].notna(), 0.4 * ret[63] + 0.6 * ret[126])
    # mã mới niêm yết dưới 6 tháng: dùng mức tăng kể từ phiên đầu tiên có dữ liệu
    listed_late = C.iloc[:5].isna().all()
    ret_ipo = C.div(C.bfill().iloc[0]) - 1
    perf = perf.where(ret[126].notna() | ~listed_late, ret_ipo)
    age = C.notna().cumsum()
    ipo_age = age.where((age <= 252) & listed_late)
    rs = (perf.where(valid).rank(axis=1, pct=True) * 98 + 1).round()
    rsline = C.div(qqq["Close"], axis=0)
    rs_nh = rsline >= rsline.rolling(252, min_periods=120).max()
    # giai đoạn Weinstein của từng mã: SMA 150 phiên ≈ SMA 30 tuần
    sl150 = s150 / s150.shift(20) - 1
    stage = pd.DataFrame(np.select(
        [(C > s150) & (sl150 > 0.01), (C < s150) & (sl150 < -0.01), (s150 > s150.shift(80)) & s150.notna(), s150.notna()],
        [2, 4, 3, 1], default=0), index=C.index, columns=C.columns)
    # Minervini/O'Neil: mã dẫn đầu thật giữ giá tốt khi thị trường giảm
    qr = raw["QQQ"]["Close"].reindex(dates).pct_change()
    qdown = pd.DataFrame(np.broadcast_to((qr <= -0.005).values[:, None], C.shape), index=C.index, columns=C.columns)
    dnb = (ret[1].sub(qr, axis=0).where(qdown) * 100).rolling(50, min_periods=3).mean()
    tt = ((C > s150) & (C > s200) & (s150 > s200) & (s200 > s200.shift(21)) & (s50 > s150)
          & (C > s50) & (C >= 0.75 * hi252) & (C >= 1.3 * lo252) & (rs >= 70))
    liquid = valid & (dv >= cfg["min_dollar_vol"]) & (C >= cfg["min_price"])
    leader = (((ret[21] >= 0.3) | (ret[63] >= 0.3) | (ret[126] >= 0.3)) & (C > e21)
              & (adr >= cfg["leader_min_adr"]) & liquid)

    def cnt(mask):
        return (mask & valid).sum(axis=1)

    n = valid.sum(axis=1).replace(0, np.nan)
    up4 = cnt((ret[1] >= 0.04) & (V > V.shift(1)))
    dn4 = cnt((ret[1] <= -0.04) & (V > V.shift(1)))
    up4a, dn4a = cnt(ret[1] >= 0.04), cnt(ret[1] <= -0.04)   # mọi phiên ±4%, không cần khối lượng
    adv, dec = cnt(C > C.shift(1)), cnt(C < C.shift(1))
    net = (adv - dec).astype(float)
    leaders_n = cnt(leader)

    # ---- nhóm mạnh nhất: top N theo RS trong các mã đủ thanh khoản
    rs_pos = perf.where(liquid).rank(axis=1, ascending=False, method="first")
    top = rs_pos <= cfg["basket_size"]
    prev_top = top.shift(1, fill_value=False).astype(bool)
    r1d = ret[1].where(prev_top)
    b_ret1 = r1d.mean(axis=1) * 100
    b_up = (r1d > 0).sum(axis=1) / prev_top.sum(axis=1).replace(0, np.nan)
    b_gain = r1d.where(r1d > 0).mean(axis=1) * 100
    b_loss = r1d.where(r1d < 0).mean(axis=1) * 100
    b_bigdown = (r1d <= -0.04).sum(axis=1)
    top5 = top.shift(5, fill_value=False).astype(bool)
    b_ret5 = ret[5].where(top5).mean(axis=1) * 100
    b_ret3 = ret[3].where(top.shift(3, fill_value=False).astype(bool)).mean(axis=1) * 100
    b_ret21 = ret[21].where(top.shift(21, fill_value=False).astype(bool)).mean(axis=1) * 100
    b_nh52 = ((C >= hi_all) & top).sum(axis=1)
    b_nh20 = ((C >= hi20) & top).sum(axis=1)
    b_w10 = ((dd_hi >= -10) & top).sum(axis=1)
    b_w20 = ((dd_hi >= -20) & top).sum(axis=1)
    b_ddmed = dd_hi.where(top).median(axis=1)
    b_above21 = ((C > e21) & top).sum(axis=1) / top.sum(axis=1).replace(0, np.nan)
    b_offhigh = ((C / hi20 - 1) * 100).where(top).mean(axis=1)
    breakout = liquid & (C >= hi20) & (C.shift(1) < hi20.shift(1))
    bo5 = breakout.shift(5, fill_value=False).astype(bool)
    bo_n = bo5.sum(axis=1)
    bo_ok = ((C > C.shift(5)) & bo5).sum(axis=1) / bo_n.replace(0, np.nan)
    bo_ret = ret[5].where(bo5).mean(axis=1) * 100
    b_down2_5d = (b_ret1 <= -2).rolling(5, min_periods=1).sum()

    # ---- chỉ số
    idx_reg = {k: regime(raw[k]["Close"].reindex(dates)) for k in INDEXES if k in raw}
    dd = {k: distribution_days(raw[k]["Close"].reindex(dates), raw[k]["Volume"].reindex(dates)) for k in ("QQQ", "SPY") if k in raw}
    qc = qqq["Close"]
    qw = qc.resample("W-FRI").last().ewm(span=9, adjust=False).mean().reindex(dates, method="ffill")

    hist = pd.DataFrame({
        "n": n,
        "pct_e9": cnt(C > e9) / n * 100,
        "pct_e21": cnt(C > e21) / n * 100,
        "pct_s40": cnt(C > s40) / n * 100,
        "pct_s50": cnt(C > s50) / n * 100,
        "pct_s200": cnt(C > s200) / n * 100,
        "nh20": cnt(C >= hi20), "nl20": cnt(C <= lo20),
        "nh52": cnt(C >= hi252), "nl52": cnt(C <= lo252),
        "up4": up4, "dn4": dn4,
        "up4a": up4a, "dn4a": dn4a, "net4": up4 - dn4, "net4a": up4a - dn4a,
        "net4_10": (up4 - dn4).rolling(10, min_periods=3).sum(), "net4a_10": (up4a - dn4a).rolling(10, min_periods=3).sum(),
        "up4_vp": up4.rolling(10, min_periods=3).sum() / up4a.rolling(10, min_periods=3).sum().replace(0, np.nan) * 100,
        "dn4_vp": dn4.rolling(10, min_periods=3).sum() / dn4a.rolling(10, min_periods=3).sum().replace(0, np.nan) * 100,
        "ratio5": up4.rolling(5).sum() / dn4.rolling(5).sum().replace(0, np.nan),
        "ratio10": up4.rolling(10).sum() / dn4.rolling(10).sum().replace(0, np.nan),
        "q_up25": cnt(ret[63] >= 0.25), "q_dn25": cnt(ret[63] <= -0.25),
        "mcclellan": net.ewm(span=19, adjust=False).mean() - net.ewm(span=39, adjust=False).mean(),
        "leaders": leaders_n,
        "leader_health": cnt(top & (C > e9)) / top.sum(axis=1).replace(0, np.nan) * 100,  # % top 100 còn trên EMA 9
        "pct_tt": cnt(tt) / n * 100,
        "b_ret1": b_ret1, "b_up": b_up * 100, "b_gain": b_gain, "b_loss": b_loss,
        "b_bigdown": b_bigdown, "b_ret5": b_ret5, "b_above21": b_above21 * 100,
        "b_offhigh": b_offhigh, "b_down2_5d": b_down2_5d,
        "b_ret3": b_ret3, "b_ret21": b_ret21, "b_nh52": b_nh52, "b_nh20": b_nh20,
        "b_w10": b_w10, "b_w20": b_w20, "b_ddmed": b_ddmed,
        "m_nh": cnt(C >= hi_all), "m_w10": cnt(dd_hi >= -10), "m_w20": cnt(dd_hi >= -20),
        "bo_n": bo_n, "bo_ok": bo_ok * 100, "bo_ret": bo_ret,
        "qqq": qc, "qqq_e9": ema(qc, 9), "qqq_e21": ema(qc, 21), "qqq_e50": ema(qc, 50), "qqq_w9": qw,
        "qqq_regime": idx_reg.get("QQQ"), "iwm_regime": idx_reg.get("IWM"),
        "dd_qqq": dd.get("QQQ"), "dd_spy": dd.get("SPY"),
    }, index=dates)

    # ---- cảnh báo và điểm sức khỏe theo từng ngày
    lead_pct = hist["leaders"].rolling(120, min_periods=20).apply(lambda w: (w <= w[-1]).mean(), raw=True)
    alerts, levels, scores = [], [], []
    for d, r in hist.iterrows():
        red, yel, grn = [], [], []
        if r.b_ret5 <= -5: red.append(f"Nhóm mạnh nhất giảm trung bình {r.b_ret5:.1f}% trong 5 phiên")
        elif r.b_ret5 < 0: yel.append(f"Nhóm mạnh nhất giảm {r.b_ret5:.1f}% trong 5 phiên")
        elif r.b_ret5 >= 2: grn.append(f"Nhóm mạnh nhất tăng {r.b_ret5:.1f}% trong 5 phiên")
        if r.b_above21 < 40: red.append(f"Chỉ {r.b_above21:.0f}% mã mạnh nhất còn trên EMA 21")
        elif r.b_above21 < 60: yel.append(f"{r.b_above21:.0f}% mã mạnh nhất còn trên EMA 21")
        if r.bo_n >= 5:
            if r.bo_ok < 35: red.append(f"Breakout thất bại: chỉ {r.bo_ok:.0f}% breakout 5 phiên trước còn giữ giá")
            elif r.bo_ok < 50: yel.append(f"Breakout yếu: {r.bo_ok:.0f}% còn giữ giá sau 5 phiên")
            elif r.bo_ok >= 60: grn.append(f"Breakout hiệu quả: {r.bo_ok:.0f}% còn giữ giá sau 5 phiên")
        if r.b_down2_5d >= 2: yel.append(f"{int(r.b_down2_5d)} phiên giảm mạnh (≤ −2%) của nhóm mạnh nhất trong 5 phiên")
        ddq = 0 if pd.isna(r.dd_qqq) else r.dd_qqq
        if ddq >= 6: red.append(f"QQQ có {int(r.dd_qqq)} ngày phân phối trong 25 phiên")
        elif ddq >= 4: yel.append(f"QQQ có {int(r.dd_qqq)} ngày phân phối trong 25 phiên")
        if r.qqq_regime == "Xấu": yel.append("QQQ dưới các EMA đang dốc xuống")
        level = "Đỏ" if red else ("Vàng" if yel else "Xanh")
        levels.append(level)
        alerts.append(red + yel + (grn if level == "Xanh" else []))
        nz = lambda x, dflt=0.0: dflt if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)
        sq = {"Tốt": 20, "Giằng co": 10, "Xấu": 0}.get(r.qqq_regime, 10)
        sd = max(0.0, 10 - 2 * max(0.0, nz(r.dd_qqq) - 2))
        se = nz(r.pct_e21) / 100 * 15
        sl = nz(lead_pct.get(d), 0.5) * 15
        sh = nz(r.leader_health) / 100 * 10
        sr = min(1, max(0, (nz(r.ratio10, 1.0) - 0.5) / 1.5)) * 15
        sn = min(1, max(0, ((nz(r.nh52) - nz(r.nl52)) / nz(r.n, 1.0) + 0.05) / 0.10)) * 15
        scores.append(round(sq + sd + se + sl + sh + sr + sn))
    hist["alert"] = levels
    hist["score"] = scores
    hist["alert_reasons"] = alerts

    def stance(s):
        return "Tấn công" if s >= 70 else "Bình thường" if s >= 50 else "Thận trọng" if s >= 30 else "Phòng thủ"

    # ---- xếp hạng ngành (giống bảng 197 nhóm ngành của IBD): trung vị sức mạnh giá các mã trong ngành
    ind_s = pd.Series({t: industry.get(t) or theme.get(t, "Khác") for t in stocks})
    g_perf = perf.where(valid).T.groupby(ind_s).median().T
    g_cnt = valid.T.groupby(ind_s).sum().T
    g_perf = g_perf.where(g_cnt >= 3)
    g_rank = g_perf.rank(axis=1, ascending=False, method="min")

    # ---- thống kê mẫu hình: mỗi ngày mẫu hình nào xuất hiện, sau 1/3/5/21 phiên kết quả ra sao
    base = liquid & (rs >= 70)
    hiH20p = H.shift(1).rolling(20, min_periods=15).max()
    tight20 = ((H.rolling(20, min_periods=15).max() / L.rolling(20, min_periods=15).min() - 1).shift(1) <= 0.30)
    low3 = L.rolling(3, min_periods=1).min()
    gap_ep = (O / C.shift(1) - 1 >= 0.08) & (V >= 3 * v50)
    PATTERNS = {
        "Breakout nền": ("break", base & (C > hiH20p) & (V > 1.5 * v50) & tight20),
        "Vượt đỉnh 52 tuần": ("break", base & (C >= hi_all) & (C.shift(1) < hi_all.shift(1))),
        "Bứt phá 4%": ("break", base & (ret[1] >= 0.04) & (V > V.shift(1)) & (V > v50)),
        "Inside day bứt lên": ("break", base & (H.shift(1) <= H.shift(2)) & (L.shift(1) >= L.shift(2)) & (C > H.shift(1))),
        "Gap tăng mạnh (EP)": ("break", liquid & gap_ep & (C > e50)),
        "Về EMA 21 bật lên": ("pull", base & (e21 > e21.shift(5)) & (C > e50) & (low3 <= e21 * 1.01) & (C > e21) & (C > H.shift(1))),
        "Lấy lại EMA 9": ("pull", base & (C > e9) & (C.shift(1) < e9.shift(1)) & (e21 > e21.shift(5)) & (C > e50)),
        "Về EMA 50 bật lên": ("pull", base & (e50 > e50.shift(10)) & (low3 <= e50 * 1.01) & (C > e50) & (C > H.shift(1))),
    }
    fwd = {h: C.shift(-h) / C - 1 for h in (1, 3, 5, 21)}
    stop5 = L.rolling(5, min_periods=5).min().shift(-5) < L
    W = 20
    pat_stats, pat_series = [], {}
    keep_n = cfg["history_days"]
    for name, (kind, sig) in PATTERNS.items():
        sig = sig.fillna(False).astype(bool)
        row = {"p": name, "kind": kind, "today": int(sig.iloc[-1].sum())}
        ser_out = {}
        for h, f in fwd.items():
            ok = sig & f.notna()
            cnt = ok.sum(axis=1).rolling(W, min_periods=1).sum()
            wins = (ok & (f > 0)).sum(axis=1).rolling(W, min_periods=1).sum()
            tot = f.where(ok).sum(axis=1).rolling(W, min_periods=1).sum()
            # dịch h phiên: giá trị tại ngày d chỉ dùng tín hiệu đã có kết quả vào ngày d
            cnt_k, win_k, avg_k = cnt.shift(h), (wins / cnt.replace(0, np.nan)).shift(h) * 100, (tot / cnt.replace(0, np.nan)).shift(h) * 100
            row[f"n{h}"], row[f"win{h}"], row[f"avg{h}"] = int(cnt_k.iloc[-1] or 0), r1(win_k.iloc[-1], 0), r1(avg_k.iloc[-1], 2)
            if h == 5:
                ser_out = {"win5": win_k, "avg5": avg_k, "n5": cnt_k}
                ok_s = sig & stop5.notna() & f.notna()
                st = (ok_s & stop5).sum(axis=1).rolling(W, min_periods=1).sum() / ok_s.sum(axis=1).rolling(W, min_periods=1).sum().replace(0, np.nan)
                row["stop5"] = r1(st.shift(5).iloc[-1] * 100, 0)
                c120 = ok.sum(axis=1).rolling(120, min_periods=20).sum()
                w120 = (ok & (f > 0)).sum(axis=1).rolling(120, min_periods=20).sum()
                row["win5_base"] = r1((w120 / c120.replace(0, np.nan)).shift(5).iloc[-1] * 100, 0)
        pat_stats.append(row)
        pat_series[name] = {k: [r1(x, 1) for x in v.iloc[-keep_n:]] for k, v in ser_out.items()}
    sig_today = {t: [n for n, (_, sg) in PATTERNS.items() if bool(sg[t].iloc[-1]) is True] for t in stocks}

    # ---- TOP 100: breakout giữ giá bao lâu, điều chỉnh bao lâu thì lên đỉnh mới
    hiprev = C.shift(1).rolling(20, min_periods=15).max()
    bo_ev = (C > hiprev) & ~(C.shift(1) > hiprev.shift(1)) & top
    surv = {}
    for k in range(1, 21):
        m_k = C.rolling(k, min_periods=k).min().shift(-k)       # giá đóng cửa thấp nhất trong k phiên sau
        surv[k] = (m_k >= hiprev).where(m_k.notna() & bo_ev)    # True = vẫn trên điểm breakout
    def surv_curve(rows):
        out = []
        for k in range(1, 21):
            x = surv[k].iloc[rows].values
            n_ = np.isfinite(x.astype(float)).sum()
            out.append(r1(np.nansum(x.astype(float)) / n_ * 100, 1) if n_ >= 5 else None)
        return out
    nd = len(dates)
    bo_recent, bo_before = surv_curve(slice(nd - 40, nd)), surv_curve(slice(max(0, nd - 160), nd - 40))
    def med_hold(curve):
        for k, v in enumerate(curve, 1):
            if v is not None and v < 50:
                return k
        return None if all(v is None for v in curve) else 21
    s5 = surv[5]
    cnt5 = s5.notna().sum(axis=1).rolling(20, min_periods=1).sum()
    ok5 = (s5 == True).sum(axis=1).rolling(20, min_periods=1).sum()  # noqa: E712
    hist["tb_hold5"] = (ok5 / cnt5.replace(0, np.nan) * 100).shift(5)
    hist["tb_n"] = bo_ev.sum(axis=1).rolling(20, min_periods=1).sum()
    # mức độ lập đỉnh: trung bình 10 phiên số mã top 100 lập đỉnh 20 phiên
    hist["b_nh20_ma"] = hist["b_nh20"].rolling(10, min_periods=3).mean()

    # các nhịp điều chỉnh của mã đang ở top 100 khi lập đỉnh
    eps_rows = []
    cand = [t for t in stocks if top[t].iloc[-180:].any()]
    Cv = C[cand].values
    Tv = top[cand].values
    for j, t in enumerate(cand):
        c = Cv[:, j]
        peak, pi, trough, inpb = np.nan, -1, np.nan, False
        for i in range(nd):
            x = c[i]
            if not np.isfinite(x):
                continue
            if not np.isfinite(peak) or x >= peak:
                if inpb and pi >= 0 and Tv[pi, j] and (trough / peak - 1) <= -0.03:
                    eps_rows.append((i, i - pi, (trough / peak - 1) * 100, True))
                peak, pi, trough, inpb = x, i, x, False
                continue
            inpb, trough = True, min(trough, x)
            if (trough / peak - 1) <= -0.25 or i - pi > 60:  # gãy: sâu hơn 25% hoặc 60 phiên chưa lên lại
                if Tv[pi, j]:
                    eps_rows.append((i, i - pi, (trough / peak - 1) * 100, False))
                peak, pi, trough, inpb = x, i, x, False
    ep = pd.DataFrame(eps_rows, columns=["end", "days", "depth", "rec"]) if eps_rows else pd.DataFrame(columns=["end", "days", "depth", "rec"])
    def pb_stats(lo, hi):
        g = ep[(ep.end >= lo) & (ep.end < hi)]
        r = g[g.rec]
        return {"n": int(len(g)), "rec_rate": r1(len(r) / len(g) * 100, 0) if len(g) else None,
                "days": r1(r.days.median(), 0) if len(r) else None, "depth": r1(r.depth.median(), 1) if len(r) else None,
                "days_q3": r1(r.days.quantile(0.75), 0) if len(r) else None}
    pb_recent, pb_before = pb_stats(nd - 40, nd), pb_stats(nd - 160, nd - 40)
    roll_days, roll_depth, roll_rec = [], [], []
    for i in range(nd):
        g = ep[(ep.end > i - 40) & (ep.end <= i)] if len(ep) else ep
        r = g[g.rec] if len(g) else g
        roll_days.append(r.days.median() if len(r) >= 5 else np.nan)
        roll_depth.append(r.depth.median() if len(r) >= 5 else np.nan)
        roll_rec.append(len(r) / len(g) * 100 if len(g) >= 5 else np.nan)
    hist["pb_days"], hist["pb_depth"], hist["pb_rec"] = roll_days, roll_depth, roll_rec

    # trạng thái hiện tại của từng mã top 100
    peak60 = C.rolling(60, min_periods=10).max()
    since_peak = {}
    for t in stocks:
        if not top[t].iloc[-1]:
            continue
        w = C[t].iloc[-60:].values
        if np.isfinite(w).sum() < 5:
            continue
        since_peak[t] = int(len(w) - 1 - np.nanargmax(w))
    bo_hold = {}
    for t in since_peak:
        ev = np.where(bo_ev[t].iloc[-60:].values)[0]
        if len(ev):
            i0 = nd - 60 + ev[-1]
            lvl = hiprev[t].iloc[i0]
            if np.isfinite(lvl) and np.nanmin(C[t].iloc[i0:].values) >= lvl:
                bo_hold[t] = nd - 1 - i0
    top100 = list(since_peak)
    ddp = (C.iloc[-1] / peak60.iloc[-1] - 1) * 100
    state = {"at_high": 0, "pb_short": 0, "pb_mid": 0, "pb_long": 0}
    for t in top100:
        d_, dp = since_peak[t], ddp[t]
        if dp > -3 or d_ == 0:
            state["at_high"] += 1
        elif d_ <= 5:
            state["pb_short"] += 1
        elif d_ <= 15:
            state["pb_mid"] += 1
        else:
            state["pb_long"] += 1
    top_stats = {"bo_recent": bo_recent, "bo_before": bo_before, "bo_med": med_hold(bo_recent), "bo_med_before": med_hold(bo_before),
                 "bo_n_recent": int(bo_ev.iloc[-40:].values.sum()), "pb_recent": pb_recent, "pb_before": pb_before, "state": state,
                 "holding": len(bo_hold)}

    # ---- thêm vài đặc điểm cho bộ lọc siêu cổ
    upv = V.where(C > C.shift(1), 0).rolling(50, min_periods=30).sum()
    dnv = V.where(C < C.shift(1), 0).rolling(50, min_periods=30).sum()
    udv = upv / dnv.replace(0, np.nan)
    ep63 = gap_ep.rolling(63, min_periods=1).max().astype(bool)
    e21up = (C > e21) & (e21 > e21.shift(5))

    # ---- chu kỳ thị trường: tăng / điều chỉnh / giằng co / giảm
    import cycle
    try:
        top_idx = (1 + (hist["b_ret1"].fillna(0) / 100)).cumprod() * 100
        cyc = {"notes": []} if light else cycle.analyze(qc, top_idx, C, e21, top, adr, cfg["history_days"])
    except Exception as e:
        print("Chu kỳ lỗi:", e, file=sys.stderr)
        cyc = {"notes": ["Chưa tính được chu kỳ thị trường."]}

    # ---- kiểm chứng ngược các phương pháp và tín hiệu VSA hôm nay
    import backtest
    ind_rank_p = pd.DataFrame({t: (g_rank[ind_s[t]] if ind_s[t] in g_rank else pd.Series(np.nan, index=dates)) for t in stocks})
    n_ind0 = int(g_rank.iloc[-1].notna().sum()) or 1
    try:
        if light:
            vs_ = backtest.vsa_signals(O, H, L, C, V, e21, e50, s150, v50, liquid)
            raise _Light({t: [n for n, sg in vs_.items() if bool(sg[t].iloc[-1])] for t in stocks})
        bt, vsa_today = backtest.run(dict(O=O, H=H, L=L, C=C, V=V, e9=e9, e21=e21, e50=e50, s150=s150, v50=v50, adr=adr, dv=dv,
                                          liquid=liquid, rs=rs, rs_pos=rs_pos, tt=tt, ret=ret, hi20=hi20, hiprev=hiprev, dd_hi=dd_hi,
                                          udv=udv, stage=stage, ind_rank=ind_rank_p, n_ind=n_ind0,
                                          qqq_regime=idx_reg.get("QQQ", pd.Series("Giằng co", index=dates)),
                                          dd_qqq=dd.get("QQQ", pd.Series(0, index=dates))), cfg)
        bt["notes"] = backtest.notes(bt, {"ml": "Martin Luk", "qm": "Qullamaggie", "mm": "Mark Minervini", "wo": "William O'Neil",
                                          "sw": "Stan Weinstein", "pb": "Pradeep Bonde", "ok": "Oliver Kell", "vs": "VSA"})
    except _Light as lt:
        bt, vsa_today = {"strategies": {}, "vsa_types": [], "notes": []}, lt.args[0]
    except Exception as e:  # kiểm chứng lỗi không làm hỏng cả lần chạy
        print("Kiểm chứng lỗi:", e, file=sys.stderr)
        bt, vsa_today = {"strategies": {}, "vsa_types": [], "notes": ["Chưa chạy được phần kiểm chứng."]}, {}

    bt_raw, bt_vsa, bt_start = bt.pop("_raw", {}), bt.pop("_vsa", None), bt.pop("_start", 260)
    upv = V.where(C > C.shift(1), 0).rolling(50, min_periods=30).sum()
    dnv = V.where(C < C.shift(1), 0).rolling(50, min_periods=30).sum()
    udv = upv / dnv.replace(0, np.nan)

    # ---- Money Flow Radar và phòng thí nghiệm setup
    flow_out, lab, lab_today, fctx = {"stage": None}, {"setups": []}, {}, None
    if not light:
        import flow
        import setuplab
        try:
            fctx = dict(O=O, C=C, H=H, L=L, V=V, valid=valid, liquid=liquid, e21=e21, s50=s50, s200=s200, rs=rs, top=top, rs_nh=rs_nh,
                        v50=v50, dd_hi=dd_hi, udv=udv, hist=hist, qqq=qqq, spy=raw["SPY"]["Close"].reindex(dates) if "SPY" in raw else None,
                        g_rank=g_rank, ind_s=ind_s, start=bt_start, keep=cfg["history_days"], rsline=rsline, adr=adr, dnb=dnb)
            flow_out, fser = flow.compute(fctx)
            fctx.update(ev=fser["ev"], piv=fser["piv"])
            hist["flow_stage"] = fser["stage"]
            hist["flow_gold"] = fser["gold"]
            hist["flow_breadth"], hist["flow_accum"], hist["flow_lead"], hist["flow_ft"] = fser["breadth"], fser["accum"], fser["lead"], fser["ft"]
            n_ind_d = g_rank.notna().sum(axis=1).replace(0, np.nan).values
            ctxm = {"stage": fser["stage"].values, "reg": idx_reg.get("QQQ", pd.Series("Giằng co", index=dates)).values,
                    "btr": (fser["breadth"] - fser["breadth"].shift(10)).values, "ind_rank": ind_rank_p, "n_ind": n_ind_d,
                    "gold": fser["gold"].values}
            lab, lab_today = setuplab.analyze(dict(O=O, H=H, L=L, C=C, V=V, e21=e21, e50=e50, s50=s50, s200=s200, v50=v50, rs=rs,
                                                   liquid=liquid, tt=tt), ctxm, bt_start, flow_out.get("stage"))
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("Money Flow Radar / setup lỗi:", e, file=sys.stderr)

    # ---- điểm ngành dẫn
    groups_out = {"rows": []}
    if not light:
        import groups as _grp
        try:
            groups_out, _ = _grp.compute(dict(C=C, H=H, L=L, V=V, valid=valid, liquid=liquid, rs=rs, s50=s50, dd_hi=dd_hi, adr=adr, perf=perf,
                                              ind_s=ind_s, spy=raw["SPY"]["Close"].reindex(dates).ffill() if "SPY" in raw else qc, start=bt_start))
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("Điểm ngành dẫn lỗi:", e, file=sys.stderr)

    # ---- mẫu hình / phong cách nào hiệu quả trong điều kiện thị trường nào
    cond = {"items": [], "dims": [], "notes": []}
    if not light:
        import condstats
        try:
            cond = condstats.analyze(hist, cycle.phase_series(qc), {n: sg for n, (_, sg) in PATTERNS.items()}, C, L, bt_raw,
                                     {"ml": "Martin Luk", "qm": "Qullamaggie", "mm": "Mark Minervini", "wo": "William O'Neil",
                                      "sw": "Stan Weinstein", "pb": "Pradeep Bonde", "ok": "Oliver Kell", "vs": "VSA"},
                                     vsa=bt_vsa, start=bt_start)
        except Exception as e:
            print("Thống kê theo điều kiện thị trường lỗi:", e, file=sys.stderr)
            cond = {"items": [], "dims": [], "notes": ["Chưa tính được thống kê theo điều kiện thị trường."]}

    # ---- đỉnh và đáy gần nhất của QQQ (sóng ≥ 7%): đo mỗi mã, mỗi ngành đã đi được bao nhiêu từ đó
    import cycle as _cy
    sw_q = _cy.zigzag(qc, 0.07)
    pk_list = [x["to"] for x in sw_q if x["dir"] == "up" and not x.get("open")] + [x["from"] for x in sw_q if x["dir"] == "down"]
    tr_list = [x["to"] for x in sw_q if x["dir"] == "down" and not x.get("open")] + [x["from"] for x in sw_q if x["dir"] == "up"]
    anchors = {}
    for key, lst in (("pk", pk_list), ("tr", tr_list)):
        if lst:
            d_ = pd.Timestamp(max(lst))
            anchors[key] = {"d": d_.strftime("%Y-%m-%d"), "qqq": r1((qc.iloc[-1] / qc.loc[d_] - 1) * 100, 1), "px": C.loc[d_]}
    r_from = {k: (C.iloc[-1] / v["px"] - 1) * 100 for k, v in anchors.items()}

    # ---- ảnh chụp hôm nay
    t0 = -1
    last = dates[t0]
    stk = []
    for t in stocks:
        if not valid[t].iloc[t0]:
            continue
        stk.append({
            "t": t, "name": names.get(t) or None, "theme": theme.get(t, "Khác"), "close": r1(C[t].iloc[t0], 2),
            "chg": r1(ret[1][t].iloc[t0] * 100), "r5": r1(ret[5][t].iloc[t0] * 100),
            "r21": r1(ret[21][t].iloc[t0] * 100), "r63": r1(ret[63][t].iloc[t0] * 100),
            "r126": r1(ret[126][t].iloc[t0] * 100), "rs": r1(rs[t].iloc[t0], 0),
            "r_pk": r1(r_from["pk"][t]) if "pk" in r_from else None, "r_tr": r1(r_from["tr"][t]) if "tr" in r_from else None,
            "adr": r1(adr[t].iloc[t0]), "dv": r1(dv[t].iloc[t0] / 1e6, 0),
            "d9": r1((C[t].iloc[t0] / e9[t].iloc[t0] - 1) * 100), "d21": r1((C[t].iloc[t0] / e21[t].iloc[t0] - 1) * 100),
            "d50": r1((C[t].iloc[t0] / e50[t].iloc[t0] - 1) * 100),
            "gap921": r1(abs(e9[t].iloc[t0] - e21[t].iloc[t0]) / C[t].iloc[t0] * 100),
            "offhigh": r1((C[t].iloc[t0] / hi252[t].iloc[t0] - 1) * 100) if pd.notna(hi252[t].iloc[t0]) else None,
            "tt": bool(tt[t].iloc[t0]), "leader": bool(top[t].iloc[t0]), "leader5": bool(top[t].iloc[t0 - 5]),  # một danh sách duy nhất: top 100
            "rsnh": bool(rs_nh[t].iloc[t0]), "top": bool(top[t].iloc[t0]), "setups": [],
            "r3": r1(ret[3][t].iloc[t0] * 100), "rs_pos": r1(rs_pos[t].iloc[t0], 0), "dd": r1(dd_hi[t].iloc[t0]),
            "ind": ind_s.get(t), "ind_rank": r1(g_rank[ind_s[t]].iloc[t0], 0) if ind_s.get(t) in g_rank else None,
            "e21up": bool(e21up[t].iloc[t0]), "udv": r1(udv[t].iloc[t0], 2), "ep63": bool(ep63[t].iloc[t0]),
            "mcap": r1(float(shares[t]) * C[t].iloc[t0] / 1e9, 1) if shares.get(t) else None,
            "sig": sig_today.get(t, []), "vsa": vsa_today.get(t, []),
            "stage": int(stage[t].iloc[t0]) or None, "dnb": r1(dnb[t].iloc[t0], 2),
            "ipo": r1(ipo_age[t].iloc[t0], 0),
            "h": r1(H[t].iloc[t0], 2), "l": r1(L[t].iloc[t0], 2), "e9v": r1(e9[t].iloc[t0], 2), "e21v": r1(e21[t].iloc[t0], 2),
            "s150v": r1(s150[t].iloc[t0], 2), "piv": r1(H[t].iloc[-20:].max(), 2), "lo10": r1(L[t].iloc[-10:].min(), 2),
            "vr": r1(V[t].iloc[t0] / v50[t].iloc[t0], 2) if v50[t].iloc[t0] else None,
            "pk_days": since_peak.get(t), "pk_dd": r1(ddp[t], 1) if t in since_peak else None, "bo_hold": bo_hold.get(t),
        })
    sdict = {s["t"]: s for s in stk}

    # ---- setup (chỉ phía mua)
    setups = []
    cap, risk, maxstop, maxpos = cfg["capital"], cfg["risk_pct"] / 100, cfg["max_stop_pct"], cfg["max_pos_pct"] / 100
    rng5 = ((H - L) / C * 100).rolling(5).mean()
    def scan(t, s):
        c, o, h, l, v = (x[t].values for x in (C, O, H, L, V))
        e9v, e21v, e50v = e9[t].values, e21[t].values, e50[t].values
        rsv = rs[t].iloc[t0]
        tags = []
        if top[t].iloc[t0] and rng5[t].iloc[t0] < 0.6 * adr[t].iloc[t0] and c[t0] >= 0.92 * hi20[t].iloc[t0] and c[t0] > e21v[t0]:
            tags.append("Nền chặt")
        if o[t0] / c[t0 - 1] - 1 >= 0.10 and v[t0] >= 3 * v50[t].iloc[t0] and c[t0] > e50v[t0]:
            tags.append("EP")
        if tt[t].iloc[t0] and len(c) > 60:
            seg = [c[-45:-30], c[-30:-15], c[-15:]]
            depth = [(x.max() - x.min()) / x.max() for x in seg]
            if depth[0] > depth[1] > depth[2] and depth[2] < 0.08 and V[t].iloc[-10:].mean() < 0.8 * v50[t].iloc[t0] and c[t0] >= 0.92 * np.nanmax(c[-60:]):
                tags.append("VCP")
        if top[t].iloc[t0] and np.nanmin(l[-3:]) <= e21v[t0] * 1.01 and c[t0] > e9v[t0] and e9v[t0] > e21v[t0] and e21v[t0] > e21v[-6]:
            tags.append("EMA crossback")
        if rsv >= 70 and abs(e9v[t0] - e21v[t0]) / c[t0] < 0.015 and c[t0] > e50v[t0]:
            tags.append("EMA hội tụ")
        inside = h[t0] <= h[t0 - 1] and l[t0] >= l[t0 - 1]
        if rsv >= 70 and c[t0] > e50v[t0] and inside:
            tags.append("2 inside day" if (h[t0 - 1] <= h[t0 - 2] and l[t0 - 1] >= l[t0 - 2]) else "Inside day")
        if rsv >= 70 and l[t0] < e9v[t0] < c[t0] and e21v[t0] > e21v[-6]:
            tags.append("Lấy lại EMA 9")
        # AVWAP neo từ đáy 52 tuần và từ cú gap lớn gần nhất (thường là báo cáo lợi nhuận)
        n_ = len(c)
        look = max(0, n_ - 252)
        a_low = look + int(np.nanargmin(c[look:]))
        gaps = [i for i in range(max(1, n_ - 126), n_) if c[i - 1] and o[i] / c[i - 1] - 1 >= 0.05 and v[i] >= 2 * np.nanmean(v[max(0, i - 50):i])]
        av_low = anchored_vwap(h, l, c, v, a_low)
        av_gap = anchored_vwap(h, l, c, v, gaps[-1]) if gaps else np.full(n_, np.nan)
        for av in (av_low[t0], av_gap[t0]):
            if rsv >= 70 and not np.isnan(av) and l[t0] < av < c[t0]:
                tags.append("Lấy lại AVWAP")
                break
        s["setups"] = tags
        s["_av"] = (av_low, av_gap, a_low, gaps[-1] if gaps else None)
        if tags:
            entry = round(h[t0] * 1.001, 2)
            stop = round(l[t0] * 0.999, 2)
            sp = (entry - stop) / entry * 100
            shares = math.floor(cap * risk / (entry - stop)) if entry > stop else 0
            shares = min(shares, math.floor(cap * maxpos / entry))
            setups.append({"t": t, "name": s.get("name"), "theme": s["theme"], "ind": s["ind"], "ind_rank": s["ind_rank"], "rs_pos": s["rs_pos"], "setups": tags, "rs": s["rs"], "leader": s["leader"], "tt": s["tt"],
                           "close": s["close"], "entry": entry, "stop": stop, "stop_pct": r1(sp), "adr": s["adr"],
                           "ok": sp <= maxstop, "shares": shares, "value": round(shares * entry), "risk_usd": round(shares * (entry - stop)),
                           "r21": s["r21"], "d9": s["d9"]})

    for t in stocks:
        s = sdict.get(t)
        if not s or not liquid[t].iloc[t0]:
            continue
        try:
            scan(t, s)
        except Exception as e:  # một mã lỗi không làm hỏng cả lần chạy
            print(f"Bỏ qua {t}: {e}", file=sys.stderr)
    setups.sort(key=lambda x: (not x["ok"], -(x["rs"] or 0)))
    extended = sorted([s for s in stk if s["leader"] and (s["d9"] or 0) > 15], key=lambda s: -s["d9"])

    # ---- ngành
    themes = []
    df = pd.DataFrame(stk)
    for th, g in df.groupby("theme"):
        themes.append({"theme": th, "n": int(len(g)), "leaders": int(g.leader.sum()), "leaders5": int(g.leader5.sum()),
                       "tt": int(g.tt.sum()), "rs": r1(g.rs.mean(), 0), "above21": r1((g.d21 > 0).mean() * 100, 0),
                       "r5": r1(g.r5.mean()), "r21": r1(g.r21.mean()), "top": int(g.top.sum())})
    themes.sort(key=lambda x: (-x["leaders"], -(x["rs"] or 0)))

    # ---- bảng xếp hạng ngành chi tiết
    industries = []
    gr0 = g_rank.iloc[t0]
    for g, rk in gr0.dropna().sort_values().items():
        mem = [x for x in stk if x["ind"] == g]
        if not mem:
            continue
        mem.sort(key=lambda x: -(x["rs"] or 0))
        gm = pd.DataFrame(mem)
        industries.append({
            "ind": g, "rank": int(rk), "rank5": r1(g_rank[g].iloc[t0 - 5], 0), "rank21": r1(g_rank[g].iloc[t0 - 21], 0),
            "n": len(mem), "rs": r1(gm.rs.median(), 0), "r5": r1(gm.r5.median()), "r21": r1(gm.r21.median()), "r63": r1(gm.r63.median()),
            "r126": r1(gm.r126.median()), "r_pk": r1(gm.r_pk.median()) if "r_pk" in gm else None, "r_tr": r1(gm.r_tr.median()) if "r_tr" in gm else None,
            "up21": r1((gm.r21 > 0).mean() * 100, 0),
            "leaders": int(gm.leader.sum()), "top": int(gm.top.sum()), "best": [x["t"] for x in mem[:4]],
        })
    n_ind = len(industries)

    # ---- nhóm mạnh nhất hôm nay
    basket = sorted([s for s in stk if s["top"]], key=lambda s: -(s["rs"] or 0))

    # ---- biểu đồ từng mã (chỉ mã đáng chú ý để trang nhẹ)
    # quét toàn thị trường có thể ra hàng trăm mã, nên giới hạn khoảng 300 biểu đồ
    lead_top = sorted([s for s in stk if s["leader"]], key=lambda s: -(s["rs"] or 0))[:120]
    chart_set = {s["t"] for s in basket} | {x["t"] for x in setups if x["ok"]} | {s["t"] for s in lead_top}
    for x in setups:
        if len(chart_set) >= 300:
            break
        chart_set.add(x["t"])
    charts = {}
    for t in chart_set:
        k = 160
        d = dates[-k:]
        av_low, av_gap, *_ = sdict[t].get("_av", (np.full(len(dates), np.nan),) * 2)
        charts[t] = {
            "d": [x.strftime("%Y-%m-%d") for x in d],
            "o": [r1(x, 2) for x in O[t].iloc[-k:]], "h": [r1(x, 2) for x in H[t].iloc[-k:]],
            "l": [r1(x, 2) for x in L[t].iloc[-k:]], "c": [r1(x, 2) for x in C[t].iloc[-k:]],
            "v": [r1(x, 0) for x in V[t].iloc[-k:]],
            "e9": [r1(x, 2) for x in e9[t].iloc[-k:]], "e21": [r1(x, 2) for x in e21[t].iloc[-k:]], "e50": [r1(x, 2) for x in e50[t].iloc[-k:]],
            "avl": [r1(x, 2) for x in av_low[-k:]], "avg": [r1(x, 2) for x in av_gap[-k:]],
        }
    for s in stk:
        s.pop("_av", None)

    # ---- bằng chứng dòng tiền từng mã + 3 câu hỏi trước khi mua cho tín hiệu hôm nay
    radar, plans = [], []
    if fctx is not None and lab.get("setups"):
        try:
            radar = flow.stock_radar(fctx, sdict, {t: [x["s"] for x in v] for t, v in lab_today.items()})
            rmap = {x["t"]: x for x in radar}
            stg = flow_out.get("stage")
            t_ind = g_rank.iloc[t0].notna().sum() or 1
            for t, sigs in lab_today.items():
                s = sdict.get(t)
                if not s:
                    continue
                rsb = setuplab._bucket("rs", s.get("rs"))
                indb = setuplab._bucket("ind", (s["ind_rank"] / t_ind) if s.get("ind_rank") else None)
                c0 = s["close"]
                for g in sigs:
                    pv, sp = g["pv"], g["sp"]
                    if not pv or not sp or sp >= pv:
                        continue
                    entry = pv if g["kind"] != "close" else c0
                    stop_pct = (entry - sp) / entry * 100
                    sh = math.floor(cap * risk / (entry - sp)) if entry > sp else 0
                    sh = min(sh, math.floor(cap * maxpos / entry)) if entry else 0
                    hist_ = setuplab.lookup(lab, g["s"], stg, rsb, indb, (flow_out.get("golden") or {}).get("level"))
                    rd = rmap.get(t, {})
                    plans.append({"t": t, "name": s.get("name"), "ind": s.get("ind"), "rs": s.get("rs"), "close": c0, "setup": g["s"], "sig": g["sig"],
                                  "left": g["left"], "kind": g["kind"], "pivot": pv, "stop": sp, "stop_pct": r1(stop_pct),
                                  "dist": r1((pv / c0 - 1) * 100) if c0 else None, "shares": sh, "risk_usd": round(sh * (entry - sp)),
                                  "t2r": r1(entry + 2 * (entry - sp), 2), "t3r": r1(entry + 3 * (entry - sp), 2),
                                  "hi52": s.get("offhigh"), "rs_b": rsb, "ind_b": indb, "hist": hist_,
                                  "ev": rd.get("score"), "ev_n": rd.get("n"), "missing": [e["label"] for e in rd.get("ev", []) if not e["ok"]],
                                  "have": [e["label"] for e in rd.get("ev", []) if e["ok"]], "news": rd.get("news"),
                                  "ok_stop": stop_pct <= maxstop})
            plans.sort(key=lambda p: (-((p["hist"].get("stage") or {}).get("exp") or -9) if (p["hist"].get("stage") or {}).get("n", 0) >= 30 else 9, -(p["ev"] or 0)))
            for s in stk:
                if s["t"] in rmap:
                    s["mf"] = rmap[s["t"]]["score"]
                if s["t"] in lab_today:
                    s["lab"] = [x["s"] for x in lab_today[s["t"]]]
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("Radar cổ phiếu lỗi:", e, file=sys.stderr)
    flow_out["radar"] = radar[:250]
    lab["plans"] = plans

    # ---- tổng quan hôm nay
    h0, h5 = hist.iloc[t0], hist.iloc[t0 - 5]
    ftd_date, ftd_status = follow_through(qc, qqq["Volume"])
    leaders_now = {s["t"] for s in stk if s["leader"]}
    leaders_before = {s["t"] for s in stk if s["leader5"]}
    latest = {
        "asof": last.strftime("%Y-%m-%d"),
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "universe": int(h0.n), "score": int(h0.score), "score5": int(h5.score), "stance": stance(h0.score),
        "alert": h0.alert, "alert_reasons": h0.alert_reasons,
        "qqq_regime": h0.qqq_regime, "iwm_regime": h0.iwm_regime,
        "qqq_vs_w9": "trên" if qc.iloc[t0] > qw.iloc[t0] else "dưới",
        "regimes": {k: v.iloc[t0] for k, v in idx_reg.items()},
        "dd_qqq": int(h0.dd_qqq or 0), "dd_spy": int(h0.dd_spy or 0),
        "ftd_status": ftd_status, "ftd_date": ftd_date.strftime("%Y-%m-%d") if ftd_date is not None else None,
        "stage": weinstein_stage(qc),
        "leaders": int(h0.leaders), "leaders5": int(h5.leaders),
        "new_leaders": sorted(leaders_now - leaders_before), "lost_leaders": sorted(leaders_before - leaders_now),
        "leader_health": r1(h0.leader_health, 0), "pct_e21": r1(h0.pct_e21, 0), "pct_e21_5": r1(h5.pct_e21, 0),
        "pct_s40": r1(h0.pct_s40, 0), "pct_s200": r1(h0.pct_s200, 0), "pct_tt": r1(h0.pct_tt, 0),
        "nh20": int(h0.nh20), "nl20": int(h0.nl20), "nh52": int(h0.nh52), "nl52": int(h0.nl52),
        "up4": int(h0.up4), "dn4": int(h0.dn4), "up4a": int(h0.up4a), "dn4a": int(h0.dn4a), "up4_vp": r1(h0.up4_vp, 0), "dn4_vp": r1(h0.dn4_vp, 0), "ratio5": r1(h0.ratio5, 2), "ratio10": r1(h0.ratio10, 2),
        "q_up25": int(h0.q_up25), "q_dn25": int(h0.q_dn25), "mcclellan": r1(h0.mcclellan, 1),
        "basket": {k: r1(h0[k], 1) for k in ("b_ret1", "b_up", "b_gain", "b_loss", "b_bigdown", "b_ret5", "b_above21", "b_offhigh", "bo_n", "bo_ok", "bo_ret")},
        "n_setups": sum(1 for x in setups if x["ok"]),
        "n_ind": n_ind, "basket_size": cfg["basket_size"],
        "basket2": {k: r1(hist[k].iloc[t0], 1) for k in ("b_ret1", "b_ret3", "b_ret5", "b_ret21", "b_nh52", "b_nh20", "b_w10", "b_w20", "b_ddmed")} | {k + "_5": r1(hist[k].iloc[t0 - 5], 1) for k in ("b_ret5", "b_nh52", "b_w20", "b_ddmed")}
                    | {k + "_21": r1(hist[k].iloc[t0 - 21], 1) for k in ("b_nh52", "b_w20")},
        "config": cfg,
        "anchors": {k: {"d": v["d"], "qqq": v["qqq"]} for k, v in anchors.items()},
    }

    keep = hist.iloc[-cfg["history_days"]:].copy()
    history = []
    for d, r in keep.iterrows():
        rec = {"d": d.strftime("%Y-%m-%d")}
        for k, v in r.items():
            if k == "alert_reasons":
                continue
            rec[k] = v if isinstance(v, str) else r1(v, 2)
        history.append(rec)

    latest["top_stats"] = top_stats
    latest["checklist"] = checklist(latest)
    latest["notes_basket"] = basket_notes(latest["basket2"], cfg["basket_size"])
    ma = hist["b_nh20_ma"]
    latest["nh_trend"] = {"now": r1(ma.iloc[-1], 1), "d5": r1(ma.iloc[-6], 1), "d10": r1(ma.iloc[-11], 1)}
    latest["notes_basket"] += top_notes(top_stats, latest["nh_trend"])
    latest["notes_patterns"] = pattern_notes(pat_stats)
    patterns = {"stats": pat_stats, "dates": [d.strftime("%Y-%m-%d") for d in dates[-keep_n:]], "series": pat_series}
    return {"latest": latest, "history": history, "stocks": stk, "setups": setups, "extended": extended,
            "themes": themes, "basket": basket, "charts": charts, "industries": industries, "patterns": patterns, "backtest": bt, "cycle": cyc, "cond": cond, "flow": flow_out, "lab": lab, "groups": groups_out}


def _p(x, d=1):
    return "—" if x is None else f"{x:+.{d}f}%".replace(".", ",")


def checklist(L: dict) -> list[dict]:
    """Mỗi huyền thoại nhìn thị trường qua một vài chỉ báo. Xanh = thuận lợi, vàng = trung tính, đỏ = bất lợi."""
    out = []

    def add(who, rule, value, state):
        out.append({"who": who, "rule": rule, "value": value, "state": state})

    dd = L.get("dd_qqq") or 0
    add("William O'Neil", "QQQ có ít ngày phân phối", f"{dd} ngày trong 25 phiên", "good" if dd <= 3 else "warn" if dd <= 5 else "bad")
    fs = L.get("ftd_status") or ""
    add("William O'Neil", "Thị trường không trong nhịp tạo đáy", fs,
        "bad" if "đáy mới" in fs else "warn" if "Nỗ lực" in fs else "good")
    qr = L.get("qqq_regime")
    add("Martin Luk", "QQQ trên EMA 21, EMA 9 trên EMA 21", qr or "—", {"Tốt": "good", "Xấu": "bad"}.get(qr, "warn"))
    ld, ld5 = L.get("leaders") or 0, L.get("leaders5") or 0
    add("Martin Luk", "Số mã có đà tăng mạnh (≥30%) tăng lên", f"{ld} mã (5 phiên trước {ld5})",
        "good" if ld >= ld5 and ld > 0 else "bad" if ld < 0.8 * ld5 else "warn")
    nh, nl = L.get("nh52") or 0, L.get("nl52") or 0
    add("Mark Minervini", "Đỉnh mới 52 tuần nhiều hơn đáy mới", f"{nh} đỉnh / {nl} đáy",
        "good" if nh > nl else "warn" if nh >= 0.67 * nl else "bad")
    st = L.get("stage") or ""
    add("Stan Weinstein", "QQQ ở giai đoạn 2", st, "good" if "2" in st else "bad" if "4" in st else "warn")
    r10 = L.get("ratio10")
    add("Pradeep Bonde", "Mã bứt phá 4% nhiều hơn mã sập 4% (10 ngày)", "—" if r10 is None else f"tỷ lệ {r10:.2f}".replace(".", ","),
        "warn" if r10 is None else "good" if r10 >= 1 else "warn" if r10 >= 0.8 else "bad")
    b = L.get("basket") or {}
    r5, ok = b.get("b_ret5"), b.get("bo_ok")
    add("Qullamaggie", "Nhóm mạnh nhất tăng, breakout giữ được giá",
        f"{_p(r5)} 5 phiên, {('—' if ok is None else f'{ok:.0f}%')} breakout giữ giá",
        "good" if (r5 or 0) > 0 and (ok is None or ok >= 50) else "bad" if (r5 or 0) < -3 or (ok is not None and ok < 35) else "warn")
    return out


def top_notes(ts: dict, nh: dict) -> list[str]:
    out = []
    now, d10 = nh.get("now"), nh.get("d10")
    if now is not None and d10 is not None:
        if now > d10 * 1.2 + 0.5:
            out.append(f"Xu hướng lập đỉnh đang TĂNG: trung bình {now:.0f} mã top 100 lập đỉnh 20 phiên mỗi ngày, từ {d10:.0f} hai tuần trước.")
        elif now < d10 * 0.8 - 0.5:
            out.append(f"Xu hướng lập đỉnh đang GIẢM: trung bình {now:.0f} mã/ngày, từ {d10:.0f} hai tuần trước. Đà của nhóm mạnh yếu dần.")
        else:
            out.append(f"Xu hướng lập đỉnh đi ngang: khoảng {now:.0f} mã top 100 lập đỉnh 20 phiên mỗi ngày.")
    m, mb = ts.get("bo_med"), ts.get("bo_med_before")
    r = ts.get("bo_recent") or []
    s5 = r[4] if len(r) > 4 else None
    s10 = r[9] if len(r) > 9 else None
    if s5 is not None:
        txt = f"Breakout của top 100 (40 phiên gần đây, {ts.get('bo_n_recent', 0)} lần): {s5:.0f}% còn trên điểm breakout sau 5 phiên"
        if s10 is not None:
            txt += f", {s10:.0f}% sau 10 phiên"
        if m is not None:
            txt += f"; một nửa giữ được {'hơn 20' if m > 20 else m - 1} phiên trở lên"
        if mb is not None and m is not None:
            txt += " (dài hơn trước)" if m > mb else " (ngắn hơn trước, breakout dễ bị kéo ngược)" if m < mb else ""
        out.append(txt + ".")
    p, pb = ts.get("pb_recent") or {}, ts.get("pb_before") or {}
    if p.get("days") is not None:
        dp = lambda x: f"{abs(x):.1f}".replace(".", ",")
        txt = (f"Nhịp điều chỉnh gần đây của top 100 kéo dài trung vị {p['days']:.0f} phiên, sâu {dp(p['depth'])}% rồi lên đỉnh mới; "
               f"{p['rec_rate']:.0f}% nhịp điều chỉnh hồi phục được")
        if pb.get("days") is not None:
            txt += f" (trước đó: {pb['days']:.0f} phiên, sâu {dp(pb['depth'])}%, {pb['rec_rate']:.0f}% hồi phục)"
        out.append(txt + ".")
        if pb.get("rec_rate") is not None and p["rec_rate"] < pb["rec_rate"] - 10:
            out.append("Tỷ lệ hồi phục sau điều chỉnh đang giảm: mua khi điều chỉnh rủi ro hơn bình thường.")
    st = ts.get("state") or {}
    if st:
        out.append(f"Hiện tại: {st['at_high']} mã đang sát đỉnh, {st['pb_short']} mã điều chỉnh 1–5 phiên, "
                   f"{st['pb_mid']} mã 6–15 phiên, {st['pb_long']} mã trên 15 phiên.")
    return out


def basket_notes(b: dict, n: int) -> list[str]:
    """Nhận xét tự động về nhóm mạnh nhất."""
    out = []
    out.append(f"Nhóm {n} mã mạnh nhất: 1 phiên {_p(b.get('b_ret1'))}, 3 phiên {_p(b.get('b_ret3'))}, "
               f"5 phiên {_p(b.get('b_ret5'))}, 1 tháng {_p(b.get('b_ret21'))}.")
    r5, r21 = b.get("b_ret5"), b.get("b_ret21")
    if r5 is not None and r21 is not None:
        pace = r21 / 4.2
        if r5 > 0 and r5 > pace + 1:
            out.append("Đà tăng đang nhanh lên: 5 phiên gần đây tốt hơn nhịp trung bình của cả tháng.")
        elif r5 < 0 and r21 > 0:
            out.append("Nhóm mạnh vẫn tăng trong tháng nhưng đang điều chỉnh ngắn hạn. Theo dõi xem có giữ được EMA 21 không.")
        elif r5 < 0 and r21 < 0:
            out.append("Nhóm mạnh giảm cả ngắn và trung hạn: dòng tiền đang rút khỏi cổ phiếu dẫn đầu.")
        elif r5 < pace - 1:
            out.append("Đà tăng đang chậm lại so với đầu tháng.")
    nh, nh5, nh21 = b.get("b_nh52"), b.get("b_nh52_5"), b.get("b_nh52_21")
    if nh is not None:
        tr = ""
        if nh5 is not None:
            tr = "tăng" if nh > nh5 + 2 else "giảm" if nh < nh5 - 2 else "đi ngang"
        out.append(f"{int(nh)} mã lập đỉnh mới 1 năm (5 phiên trước: {int(nh5 or 0)}, 1 tháng trước: {int(nh21 or 0)}), xu hướng {tr}.")
    w, w5, w21 = b.get("b_w20"), b.get("b_w20_5"), b.get("b_w20_21")
    if w is not None:
        msg = f"{int(w)}/{n} mã cách đỉnh dưới 20% (5 phiên trước: {int(w5 or 0)}, 1 tháng trước: {int(w21 or 0)})."
        if w5 is not None and w < w5 - 0.08 * n:
            msg += " Số mã giữ được gần đỉnh giảm nhanh: nhóm mạnh đang bị bán."
        elif w >= 0.85 * n:
            msg += " Hầu hết mã mạnh vẫn ở gần đỉnh: xu hướng còn khỏe."
        elif w < 0.6 * n:
            msg += " Nhiều mã mạnh đã điều chỉnh sâu: nên chờ nền mới."
        out.append(msg)
    return out


def pattern_notes(stats: list[dict], min_n: int = 8) -> list[str]:
    """Thị trường đang thưởng cho kiểu mua nào: breakout hay mua khi điều chỉnh."""
    ok = [s for s in stats if (s.get("n5") or 0) >= min_n and s.get("win5") is not None]
    if not ok:
        return ["Chưa đủ tín hiệu trong 20 phiên để đánh giá mẫu hình."]
    out = []
    ok.sort(key=lambda s: (-(s["win5"] or 0), -(s["avg5"] or 0)))
    good = [s for s in ok if s["win5"] >= 55 and (s["avg5"] or 0) > 0.5]
    bad = [s for s in ok if s not in good and (s["win5"] < 45 or ((s.get("stop5") or 0) >= 60 and s["win5"] < 55))]
    if good:
        out.append("Thị trường đang thưởng cho: " + "; ".join(
            f"{s['p']} ({s['win5']:.0f}% có lãi sau 5 phiên, TB {_p(s['avg5'])}, {s['n5']} tín hiệu)" for s in good[:3]) + ".")
    else:
        b0 = ok[0]
        out.append(f"Chưa có mẫu hình nào hiệu quả rõ rệt. Tốt nhất là {b0['p']} với {b0['win5']:.0f}% có lãi sau 5 phiên.")
    if bad:
        out.append("Đang thất bại nhiều: " + "; ".join(
            f"{s['p']} ({s['win5']:.0f}% có lãi, {s.get('stop5') or 0:.0f}% chạm stop)" for s in bad[:3]) + ".")

    def grp(kind):
        g = [s for s in ok if s["kind"] == kind]
        n = sum(s["n5"] for s in g)
        return (sum(s["win5"] * s["n5"] for s in g) / n, sum((s["avg5"] or 0) * s["n5"] for s in g) / n) if n else (None, None)

    wb, ab = grp("break")
    wp, ap = grp("pull")
    if wb is not None and wp is not None:
        if wb > wp + 5:
            out.append(f"Mua breakout đang hiệu quả hơn mua điều chỉnh ({wb:.0f}% so với {wp:.0f}% có lãi sau 5 phiên). Ưu tiên mua khi giá vượt nền.")
        elif wp > wb + 5:
            out.append(f"Mua khi điều chỉnh về đường trung bình đang hiệu quả hơn breakout ({wp:.0f}% so với {wb:.0f}%). Breakout dễ bị kéo ngược, nên chờ giá về EMA.")
        else:
            out.append(f"Breakout và mua điều chỉnh hiệu quả tương đương ({wb:.0f}% và {wp:.0f}% có lãi sau 5 phiên).")
    fresh = [s for s in stats if (s.get("n1") or 0) >= min_n and s.get("avg1") is not None]
    if fresh:
        f0 = max(fresh, key=lambda s: s["avg1"])
        out.append(f"Phản ứng ngay phiên sau tốt nhất: {f0['p']} (TB {_p(f0['avg1'], 2)} sau 1 phiên).")
    return out


def _jd(o):
    if hasattr(o, "item"):
        v = o.item()
        return None if isinstance(v, float) and math.isnan(v) else v
    return str(o)


def write(out: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for k in ("latest", "history", "stocks", "setups", "extended", "themes", "basket", "charts", "industries", "patterns", "backtest", "cycle", "cond", "flow", "lab", "groups", "paper"):
        (DATA / f"{k}.json").write_text(json.dumps(out[k], ensure_ascii=False, separators=(",", ":"), default=_jd), encoding="utf-8")
    # lưu lại ảnh chụp setup + tổng quan mỗi ngày để thống kê về sau
    snap = DATA / "archive"
    snap.mkdir(exist_ok=True)
    day = out["latest"]["asof"]
    (snap / f"{day}.json").write_text(json.dumps({"latest": out["latest"], "setups": out["setups"],
                                                   "basket": [b["t"] for b in out["basket"]]}, ensure_ascii=False, default=_jd), encoding="utf-8")
    idx = sorted(p.stem for p in snap.glob("*.json") if p.stem != "index")
    (snap / "index.json").write_text(json.dumps(idx), encoding="utf-8")
    print("Đã ghi dữ liệu ngày", day)


def attach_fundamentals(out: dict, demo: bool = False, key: str | None = None) -> None:
    """Gắn tăng trưởng doanh thu/EPS cho các mã ứng viên (top RS, nhóm mạnh, mã có setup)."""
    import fund

    lim = CONFIG.get("fund_top", 400)
    cands = sorted({s["t"] for s in out["stocks"] if (s.get("rs_pos") or 1e9) <= lim or s["top"]} | {x["t"] for x in out["setups"]})
    try:
        F = fund.demo([s["t"] for s in out["stocks"]]) if demo else fund.load(cands, CONFIG, key)
    except Exception as e:
        print("Không tải được số liệu cơ bản:", e, file=sys.stderr)
        F = {}
    for s in out["stocks"]:
        if s["t"] in F:
            s.update(F[s["t"]])
    for x in out["setups"]:
        f = F.get(x["t"]) or {}
        x["rev_yoy"], x["eps_yoy"], x["earn"] = f.get("rev_yoy"), f.get("eps_yoy"), f.get("earn")
        st = next((s for s in out["stocks"] if s["t"] == x["t"]), {})
        x["stage"], x["ipo"], x["dd"], x["rsnh"] = st.get("stage"), st.get("ipo"), st.get("dd"), st.get("rsnh")
    out["latest"]["fund_n"] = sum(1 for s in out["stocks"] if s.get("q_end"))
    print(f"Số liệu cơ bản: {out['latest']['fund_n']} mã")
    try:
        import groups as _grp
        _grp.add_fund(out)
    except Exception as e:
        print("Cơ bản theo ngành lỗi:", e, file=sys.stderr)
    return F


def run_paper(raw, uni, out, F, demo=False):
    """Danh mục mô phỏng theo từng huyền thoại. Lần đầu chạy lại N phiên gần nhất để có kết quả ngay."""
    import paper

    st = None if demo else paper.load_state(CONFIG)
    if st is None:
        dates = raw["QQQ"].index
        B = int(CONFIG.get("paper_bootstrap_days", 30))
        i0 = max(260, len(dates) - 1 - B)
        st = paper.new_state(CONFIG, dates[i0].strftime("%Y-%m-%d"))
        print(f"Danh mục mô phỏng: chạy lại {len(dates) - 1 - i0} phiên gần nhất")
        for i in range(i0, len(dates) - 1):
            cut = dates[i]
            raw_i = {t: df[df.index <= cut] for t, df in raw.items()}
            try:
                o_i = compute(raw_i, uni, light=True)
            except SystemExit:
                continue
            for s in o_i["stocks"]:
                if s["t"] in F:
                    s.update(F[s["t"]])
            paper.run(st, raw, o_i, CONFIG, boot=True)
    paper.run(st, raw, out, CONFIG)
    if not demo:
        paper.save_state(st)
    return paper.summary(st, raw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="dùng dữ liệu giả lập")
    ap.add_argument("--yahoo", action="store_true", help="bỏ qua Massive, dùng Yahoo")
    a = ap.parse_args()
    uni = load_universe()
    key = os.environ.get("MASSIVE_API_KEY") or os.environ.get("POLYGON_API_KEY")
    if a.demo:
        raw, source = demo_data(INDEXES + list(uni.ticker)), "Giả lập"
    elif key and not a.yahoo:
        import massive
        try:
            raw, uni = massive.load(key.strip(), CONFIG, uni, INDEXES)
            source = "Massive (toàn thị trường)"
        except Exception as e:  # Massive lỗi thì vẫn có trang với Yahoo
            print("Massive lỗi, chuyển sang Yahoo:", e, file=sys.stderr)
            raw, source = download(INDEXES + list(uni.ticker), CONFIG["years"]), "Yahoo Finance (Massive lỗi)"
    else:
        raw, source = download(INDEXES + list(uni.ticker), CONFIG["years"]), "Yahoo Finance (danh sách universe.csv)"
    out = compute(raw, uni)
    out["latest"]["source"] = source
    out["latest"]["version"] = APP_VERSION
    F = attach_fundamentals(out, demo=a.demo, key=key if source.startswith("Massive") else None)
    if a.demo:
        out["latest"]["demo"] = True
    try:
        out["paper"] = run_paper(raw, uni, out, F or {}, demo=a.demo)
    except Exception as e:  # danh mục mô phỏng lỗi không làm hỏng cả trang
        import traceback
        traceback.print_exc()
        print("Danh mục mô phỏng lỗi:", e, file=sys.stderr)
        out["paper"] = {"accounts": {}, "error": str(e)}
    write(out)
    L = out["latest"]
    print(f"{L['asof']}: điểm {L['score']} ({L['stance']}), cảnh báo {L['alert']}, dẫn đầu {L['leaders']}, setup đạt chuẩn {L['n_setups']}")


if __name__ == "__main__":
    main()
